import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAmunPaths, type AmunPaths } from "./amun-paths.js";
import { runCli } from "./amun-tasks-axi-cli.js";
import {
  CaptainApprovalRequiredError,
  DeliverySync,
  JiraAdapter,
  LinearAdapter,
  MissingCredentialError,
  jiraColumn,
  linearColumn,
  type FetchLike,
} from "./delivery-sync.js";
import { firstmateEnv, readFleetSnapshot } from "./firstmate-cli.js";
import { PmStore } from "./pm-store.js";
import { ProductSpaceStore } from "./product-spaces.js";

const hasTasksAxi = (() => {
  try {
    execFileSync("tasks-axi", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let tmp: string;
let paths: AmunPaths;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "amun-pm-"));
  // Stands in for the captain's existing Firstmate home, laid out as Firstmate does.
  const fmHome = path.join(tmp, "captain-home");
  mkdirSync(path.join(fmHome, "data"), { recursive: true });
  writeFileSync(path.join(fmHome, "data", "backlog.md"), "# Backlog\n\n## In flight\n\n## Queued\n\n## Done\n");
  writeFileSync(
    path.join(fmHome, ".tasks.toml"),
    'backend = "markdown"\n\n[markdown]\npath = "data/backlog.md"\narchive = "data/done-archive.md"\n',
  );
  paths = resolveAmunPaths({ ...process.env, AMUN_HOME: tmp, AMUN_FIRSTMATE_HOME: fmHome });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Recorded-response fake: answers by matching a substring of the URL or GraphQL query. */
function recordedFetch(routes: [match: string, response: unknown][]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", body, headers: init.headers as Record<string, string> });
    const haystack = `${init.method} ${url} ${body?.query ?? ""}`;
    const route = routes.find(([match]) => haystack.includes(match));
    if (!route) return new Response(`no route for ${haystack}`, { status: 404 });
    return new Response(JSON.stringify(route[1]), { status: 200 });
  };
  return { fetch: fetchImpl, calls };
}

describe("PM store", () => {
  it("stores initiatives with the 4-Question Framework and reports gaps", () => {
    const store = new PmStore(":memory:", () => new Date("2026-11-18T00:00:00Z"));
    store.createRoadmap({ id: "h1", name: "H1 2027" });
    const first = store.upsertInitiative({ id: "billing", title: "Usage billing", what: "Metered plans", roadmapId: "h1" });
    expect(PmStore.missingQuestions(first)).toEqual(["why", "when", "cost"]);
    const done = store.upsertInitiative({ id: "billing", title: "Usage billing", why: "Churn", when: "Q2", cost: "2 eng x 6 wk" });
    expect(PmStore.missingQuestions(done)).toEqual([]);
    expect(done.what).toBe("Metered plans");
    expect(store.listInitiatives("h1").map((i) => i.id)).toEqual(["billing"]);
  });

  it("follows Firstmate's backlog onto the board as tasks-axi moves rows", () => {
    const store = new PmStore(":memory:");
    expect(store.projectBacklog([{ id: "a", title: "A", state: "queued", kind: "scout" }])).toEqual({
      created: ["a"],
      moved: [],
      unchanged: 0,
    });
    expect(store.projectBacklog([{ id: "a", title: "A", state: "in_flight", kind: "scout" }]).moved).toEqual([
      { id: "a", from: "discovery", to: "in_progress" },
    ]);
    store.projectBacklog([{ id: "a", title: "A", state: "done", kind: "scout" }]);
    expect(store.board().done.map((s) => s.id)).toEqual(["a"]);
  });
});

describe.skipIf(!hasTasksAxi)("amun-tasks-axi against a real Firstmate home", () => {
  it("files through real tasks-axi, then the board moves when Firstmate starts the task", async () => {
    const space = await new ProductSpaceStore(paths).create({ name: "Board" });
    const out: string[] = [];
    const io = { out: (t: string) => out.push(t), env: { ...process.env, AMUN_HOME: tmp, FM_HOME: space.fmHome } };

    expect(await runCli(["add", "proto-1", "Checkout wireframe", "--kind", "prototype"], io)).toBe(0);
    expect(JSON.parse(out.pop()!)).toMatchObject({ added: "proto-1", created: ["proto-1"] });

    // The transition fm-spawn.sh performs on dispatch.
    execFileSync(path.join(paths.firstmateRoot, "bin", "fm-tasks-axi.sh"), ["start", "proto-1"], {
      env: firstmateEnv({ root: paths.firstmateRoot, fmHome: space.fmHome }),
    });
    expect(await runCli(["sync"], io)).toBe(0);
    expect(JSON.parse(out.pop()!).moved).toEqual([{ id: "proto-1", from: "spec", to: "in_progress" }]);

    expect(await runCli(["board"], io)).toBe(0);
    expect(JSON.parse(out.pop()!).in_progress.map((s: { id: string }) => s.id)).toEqual(["proto-1"]);

    const snapshot = await readFleetSnapshot({ root: paths.firstmateRoot, fmHome: space.fmHome });
    expect(snapshot.backlog.records.find((r) => r.id === "proto-1")?.state).toBe("in_flight");
  }, 60_000);

  it("refuses without FM_HOME", async () => {
    await expect(runCli(["board"], { out: () => {}, env: {} })).rejects.toThrow("FM_HOME is not set");
  });
});

describe("Linear adapter", () => {
  const states = { data: { team: { states: { pageInfo: {hasNextPage:false,endCursor:null}, nodes: [
    { id: "s-back", name: "Backlog", type: "backlog" },
    { id: "s-todo", name: "Todo", type: "unstarted" },
    { id: "s-prog", name: "In Progress", type: "started" },
    { id: "s-rev", name: "In Review", type: "started" },
    { id: "s-done", name: "Done", type: "completed" },
  ] } } } };

  it("maps workflow states to columns", () => {
    expect(linearColumn({ name: "In Review", type: "started" })).toBe("review");
    expect(linearColumn({ name: "In Progress", type: "started" })).toBe("in_progress");
    expect(linearColumn({ name: "Canceled", type: "canceled" })).toBe("done");
    expect(linearColumn({ name: "Triage", type: "triage" })).toBe("backlog");
  });

  it("needs a key per account and sends it as the Authorization header", async () => {
    expect(() => LinearAdapter.fromEnv({ account: "acme", teamId: "T", env: {} })).toThrow(MissingCredentialError);
    const { fetch, calls } = recordedFetch([
      ["cycles", { data: { team: { cycles: { pageInfo: {hasNextPage:false,endCursor:null}, nodes: [
        { id: "c1", name: null, number: 7, startsAt: "2026-11-17", endsAt: "2026-11-30", isActive: true, isFuture: false },
      ] } } } }],
      ["issues(first", { data: { team: { issues: {
        nodes: [{ id: "i1", identifier: "ENG-1", title: "Checkout", state: { id: "s-rev", name: "In Review", type: "started" }, cycle: { id: "c1" } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } } }],
    ]);
    const adapter = LinearAdapter.fromEnv({ account: "acme", teamId: "T", env: { LINEAR_API_KEY_ACME: "lin_test" }, fetch });
    const store = new PmStore(":memory:");
    store.upsertStory({ id: "local-1", title: "Checkout", column: "spec" });
    store.linkExternal({ storyId: "local-1", system: "linear", account: "acme", externalId: "i1", externalKey: "ENG-1", remoteStatus: null, syncedAt: "x" });

    const pulled = await new DeliverySync(store, adapter).pull();
    expect(pulled).toMatchObject({ sprints: 1, linked: 1, moved: [{ storyId: "local-1", to: "review" }] });
    expect(store.getStory("local-1")).toMatchObject({ column: "review", sprintId: "linear:c1" });
    expect(store.listSprints()[0]).toMatchObject({ name: "Cycle 7", state: "active", source: "linear" });
    expect(calls[0]!.headers.Authorization).toBe("lin_test");
  });

  it("creates and moves issues only with the captain's approval for those stories", async () => {
    const { fetch, calls } = recordedFetch([
      ["states(first", states],
      ["issueCreate", { data: { issueCreate: { success: true, issue: { id: "i9", identifier: "ENG-9", title: "Billing", state: { id: "s-todo", name: "Todo", type: "unstarted" } } } } }],
      ["issueUpdate", { data: { issueUpdate: { success: true } } }],
    ]);
    const adapter = new LinearAdapter({ account: "default", teamId: "T", apiKey: "k", fetch });
    const store = new PmStore(":memory:");
    store.upsertStory({ id: "s1", title: "Billing", column: "in_progress" });
    const sync = new DeliverySync(store, adapter);

    await expect(sync.push(["s1"], { approvedByCaptain: true, storyIds: [] })).rejects.toThrow(CaptainApprovalRequiredError);
    expect(calls).toHaveLength(0);

    const pushed = await sync.push(["s1"], { approvedByCaptain: true, storyIds: ["s1"] });
    expect(pushed).toEqual({ created: [{ storyId: "s1", key: "ENG-9" }], moved: [{ storyId: "s1", key: "ENG-9", to: "in_progress" }] });
    const update = calls.find((c) => String((c.body as { query: string }).query).includes("issueUpdate"));
    expect((update!.body as { variables: unknown }).variables).toEqual({ id: "i9", stateId: "s-prog" });
    expect(store.externalLinks("s1")[0]).toMatchObject({ externalKey: "ENG-9" });
  });
});

describe("Jira adapter", () => {
  it("maps status categories to columns", () => {
    expect(jiraColumn({ name: "Code Review", statusCategory: { key: "indeterminate" } })).toBe("review");
    expect(jiraColumn({ name: "To Do", statusCategory: { key: "new" } })).toBe("backlog");
    expect(jiraColumn({ name: "Done", statusCategory: { key: "done" } })).toBe("done");
  });

  it("loads active and future sprints, creates into a sprint, and transitions by category", async () => {
    expect(() =>
      JiraAdapter.fromEnv({ baseUrl: "https://x.atlassian.net", projectKey: "PM", boardId: 1, env: { JIRA_EMAIL: "a@b" } }),
    ).toThrow("JIRA_API_TOKEN");
    const { fetch, calls } = recordedFetch([
      ["GET https://acme.atlassian.net/rest/agile/1.0/board/42/sprint", { startAt:0, isLast:true, values: [{ id: 5, name: "Sprint 5", state: "active" }, { id: 6, name: "Sprint 6", state: "future" }] }],
      ["/rest/software/1.0/board/42/issue?", { issues: [{ id: "100", key: "PM-1", fields: { project: {key:"PM"}, sprint: {id:5}, summary: "Roadmap", status: { name: "In Progress", statusCategory: { key: "indeterminate" } } } }] }],
      ["/rest/agile/1.0/sprint/6/issue?", { issues: [] }],
      ["POST https://acme.atlassian.net/rest/api/3/issue ", { id: "101", key: "PM-2" }],
      ["POST https://acme.atlassian.net/rest/agile/1.0/sprint/6/issue", {}],
      ["GET https://acme.atlassian.net/rest/api/3/issue/PM-2/transitions", { transitions: [
        { id: "11", name: "Start", to: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
        { id: "21", name: "Review", to: { name: "In Review", statusCategory: { key: "indeterminate" } } },
        { id: "31", name: "Done", to: { name: "Done", statusCategory: { key: "done" } } },
      ] }],
      ["POST https://acme.atlassian.net/rest/api/3/issue/PM-2/transitions", {}],
    ]);
    const adapter = JiraAdapter.fromEnv({
      baseUrl: "https://acme.atlassian.net/",
      projectKey: "PM",
      boardId: 42,
      env: { JIRA_EMAIL: "pm@acme.test", JIRA_API_TOKEN: "tok" },
      fetch,
    });
    const store = new PmStore(":memory:");
    const sync = new DeliverySync(store, adapter);
    const pulled = await sync.pull();
    expect(pulled).toEqual({ sprints: 2, linked: 0, moved: [], unlinked: ["PM-1"] });
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("pm@acme.test:tok").toString("base64")}`);

    store.upsertStory({ id: "s2", title: "PRD canvas", body: "Para one.\n\nPara two.", column: "review", sprintId: "jira:6" });
    const pushed = await sync.push(["s2"], { approvedByCaptain: true, storyIds: ["s2"] });
    expect(pushed.created).toEqual([{ storyId: "s2", key: "PM-2" }]);
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/rest/api/3/issue"))!;
    expect(create.body).toMatchObject({ fields: { project: { key: "PM" }, issuetype: { name: "Story" } } });
    expect((create.body as { fields: { description: { content: unknown[] } } }).fields.description.content).toHaveLength(2);
    const transition = calls.filter((c) => c.url.endsWith("/transitions") && c.method === "POST").pop()!;
    expect(transition.body).toEqual({ transition: { id: "21" } });
  });
});
