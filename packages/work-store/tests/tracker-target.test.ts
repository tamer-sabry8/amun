import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import { PlanPublisher } from "../src/plan-publication.ts";
import {
  trackerResolver,
  type TrackerAccess,
} from "../src/trackers/tracker-target.ts";
import { TrackerService } from "../src/trackers/tracker-service.ts";
import {
  markerLabel,
  trackerStep,
  type TrackerSession,
} from "../src/trackers/tracker-items.ts";

const CLOUD = "ca5a06a5-930e-490e-8955-453103dc863c";
const json = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
const nested = (value: unknown) => json({ data: value });

/** A Jira site as the Rovo MCP server shows it, with a lagging search index. */
class FakeJira {
  issues = new Map<
    string,
    {
      key: string;
      summary: string;
      type: string;
      parent: string | null;
      labels: string[];
      sprints: string[];
    }
  >();
  sprints: {
    id: number;
    name: string;
    state: string;
    goal: string;
    originBoardId: number;
  }[] = [];
  calls: string[] = [];
  /** Calls whose answer is lost after Jira did the work. */
  lose = new Set<string>();
  /** How many searches miss an issue created moments before. */
  searchLag = 0;
  /** Jira silently drops the parent link. */
  dropParent = false;
  private next = 1;
  tools = [
    "getAccessibleAtlassianResources",
    "createJiraIssue",
    "getJiraIssue",
    "searchJiraIssuesUsingJql",
    "executeRead",
    "executeDestructive",
  ].map((name) => ({ name }));
  session(): TrackerSession {
    return {
      tools: this.tools,
      call: async (name, args) => this.call(name, args),
    };
  }
  private async call(name: string, args: Record<string, unknown>) {
    const op = name.startsWith("execute")
      ? `${name}:${String(args.name)}:${String((args.inputs as { action?: string })?.action ?? "")}`
      : name;
    this.calls.push(op);
    const answer = this.answer(name, args);
    if (this.lose.delete(name) || this.lose.delete(op))
      throw Error("socket hang up");
    return answer;
  }
  private answer(name: string, args: Record<string, unknown>) {
    if (name !== "getAccessibleAtlassianResources" && args.cloudId !== CLOUD)
      return { isError: true, ...json("unknown site") };
    switch (name) {
      case "getAccessibleAtlassianResources":
        return json({
          data: {
            resources: [
              {
                cloudId: CLOUD,
                url: "https://acme.atlassian.net",
                products: [{ id: "jira", access: "read-write" }],
              },
            ],
          },
        });
      case "createJiraIssue": {
        if (args.projectKey !== "SCRUM")
          return {
            isError: true,
            ...json({ error: "Project not found", repairHint: "check key" }),
          };
        const key = `SCRUM-${this.next++}`;
        this.issues.set(key, {
          key,
          summary: String(args.summary),
          type: String(args.issueType),
          parent: this.dropParent ? null : ((args.parent as string) ?? null),
          labels: (args.labels as string[]) ?? [],
          sprints: args.assignToSprint ? [String(args.assignToSprint)] : [],
        });
        return nested({ id: "1", key });
      }
      case "getJiraIssue": {
        const issue = this.issues.get(String(args.issueIdOrKey));
        if (!issue) return { isError: true, ...json("not found") };
        return nested({
          key: issue.key,
          fields: {
            summary: issue.summary,
            issuetype: { name: issue.type },
            labels: issue.labels,
            ...(issue.parent ? { parent: { key: issue.parent } } : {}),
            customFields: {
              Sprint: {
                value: issue.sprints.map((id) => ({ id: Number(id) })),
              },
            },
          },
        });
      }
      case "searchJiraIssuesUsingJql": {
        if (this.searchLag > 0) {
          this.searchLag -= 1;
          return nested({ isLast: true, issues: [] });
        }
        const label = /labels = "([^"]+)"/.exec(String(args.jql))?.[1];
        return nested({
          isLast: true,
          issues: [...this.issues.values()]
            .filter((i) => i.labels.includes(label!))
            .map((i) => ({ key: i.key })),
        });
      }
      case "executeRead": {
        const inputs = args.inputs as Record<string, unknown>;
        if (args.name === "listJiraProjects")
          return nested({
            values: [
              {
                key: "SCRUM",
                issueTypes: [
                  { name: "Epic" },
                  { name: "Task" },
                  { name: "Subtask", subtask: true },
                ],
              },
            ],
          });
        if (args.name === "listJiraBoardSprints")
          return nested({
            isLast: true,
            values: this.sprints.filter(
              (s) => s.originBoardId === inputs.boardId,
            ),
          });
        return { isError: true, ...json("unknown") };
      }
      case "executeDestructive": {
        const inputs = args.inputs as Record<string, unknown>;
        if (args.name !== "manageJiraSprint")
          return { isError: true, ...json("no") };
        if (inputs.action === "create") {
          const sprint = {
            id: 10 + this.sprints.length,
            name: String(inputs.name),
            state: "future",
            goal: String(inputs.goal),
            originBoardId: Number(inputs.boardId),
          };
          this.sprints.push(sprint);
          return nested(sprint);
        }
        if (inputs.action === "start") {
          const sprint = this.sprints.find((s) => s.id === inputs.sprintId)!;
          sprint.state = "active";
          return nested(sprint);
        }
        return { isError: true, ...json("not allowed") };
      }
    }
    return { isError: true, ...json("unknown tool") };
  }
}

/** A Linear workspace as its hosted MCP server shows it. */
class FakeLinear {
  issues = new Map<
    string,
    {
      id: string;
      description: string;
      parentId: string | null;
      projectId: string | null;
      cycleId: string | null;
    }
  >();
  projects = new Map<
    string,
    {
      id: string;
      uuid: string;
      name: string;
      description: string;
      teams: { key: string }[];
    }
  >();
  calls: string[] = [];
  lose = new Set<string>();
  private next = 1;
  tools = [
    "get_workspace",
    "get_team",
    "list_cycles",
    "save_project",
    "save_issue",
    "get_issue",
    "get_project",
    "list_issues",
    "list_projects",
  ].map((name) => ({ name }));
  session(): TrackerSession {
    return {
      tools: this.tools,
      call: async (name, args) => {
        this.calls.push(name);
        const answer = this.answer(name, args);
        if (this.lose.delete(name)) throw Error("socket hang up");
        return answer;
      },
    };
  }
  private answer(name: string, args: Record<string, unknown>) {
    switch (name) {
      case "get_workspace":
        return json({ id: "w", name: "Acme", url: "https://linear.app/acme" });
      case "get_team":
        return args.query === "TRA"
          ? json({ id: "team-uuid", key: "TRA", name: "Transfrm" })
          : { isError: true, ...json("no team") };
      case "list_cycles":
        return json([{ id: "cycle-uuid", number: 3 }]);
      case "save_project": {
        const id = `P-TRA-${this.next++}`;
        this.projects.set(id, {
          id,
          uuid: "uuid-" + id,
          name: String(args.name),
          description: String(args.description),
          teams: [{ key: "TRA" }],
        });
        return json({ id });
      }
      case "save_issue": {
        const id = `TRA-${this.next++}`;
        const project = args.project
          ? this.projects.get(String(args.project))
          : undefined;
        this.issues.set(id, {
          id,
          description: String(args.description),
          parentId: (args.parentId as string) ?? null,
          projectId: project?.uuid ?? null,
          cycleId: (args.cycle as string) ?? null,
        });
        return json({ id, url: `https://linear.app/acme/issue/${id}` });
      }
      case "get_issue":
        return json(this.issues.get(String(args.id)) ?? {});
      case "get_project":
        return json(this.projects.get(String(args.query)) ?? {});
      case "list_issues":
        return json({
          hasNextPage: false,
          issues: [...this.issues.values()].filter((i) =>
            i.description.includes(String(args.query)),
          ),
        });
      case "list_projects":
        return json({
          hasNextPage: false,
          projects: [...this.projects.values()].filter(
            (p) => p.name === args.query,
          ),
        });
    }
    return { isError: true, ...json("unknown tool") };
  }
}

let db: Database;
let store: WorkStore;
let jira: FakeJira;
let linear: FakeLinear;
let connected: Set<string>;
const noWait = async () => {};
const access: TrackerAccess = {
  configured: async (provider) => connected.has(provider),
  use: async (provider, work) =>
    work(provider === "jira" ? jira.session() : linear.session()),
};
let publisher: PlanPublisher;

const send = (action: string, extra: Record<string, unknown> = {}) =>
  store
    .handle({ version: 1, kind: "work", action, ...extra })
    .find((e) => e.kind === "work-result") as {
    ok: boolean;
    ref: string | null;
    message: string;
  };
const plan = (id: string) => store.snapshot().plans.find((p) => p.id === id)!;
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function propose(
  destination: string,
  items: { summary: string; fields: Record<string, string> }[],
) {
  const proposed = send("propose-plan", {
    groupId: null,
    workAreaId: null,
    planKind: "stories",
    destination,
    summary: "Tracker plan",
    items: items.map((item, i) => ({ id: uuid(i + 1), ...item })),
  });
  expect(proposed.ok).toBe(true);
  return proposed.ref!;
}
const approve = (id: string) =>
  expect(
    send("approve-plan", { planId: id, fingerprint: plan(id).fingerprint }).ok,
  ).toBe(true);
const site = { site: "acme.atlassian.net", project: "SCRUM" };
const workspace = { site: "https://linear.app/acme", team: "TRA" };

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  store = new WorkStore(db);
  jira = new FakeJira();
  linear = new FakeLinear();
  connected = new Set(["jira", "linear"]);
  publisher = new PlanPublisher(db, store, trackerResolver(db, access, noWait));
});

describe("Jira: epics, stories and sprints from an approved plan", () => {
  it("creates the sprint, the epic and the story under it in the sprint, and reads each back", async () => {
    const id = propose("jira", [
      {
        summary: "Sprint 7",
        fields: {
          type: "Sprint",
          ...site,
          board: "1",
          start: "2026-12-07",
          end: "2026-12-18",
          "start sprint": "yes",
        },
      },
      { summary: "Checkout", fields: { type: "Epic", ...site } },
      {
        summary: "Pay by card",
        fields: {
          type: "Story",
          ...site,
          parent: "Checkout",
          sprint: "Sprint 7",
          acceptance: "- Card accepted\n- Receipt sent",
        },
      },
    ]);
    approve(id);
    await publisher.publish(id);
    expect(plan(id).state).toBe("published");
    const writes = publisher.writes(id);
    expect(writes.map((w) => [w.state, w.externalId])).toEqual([
      ["created", "10"],
      ["created", "SCRUM-1"],
      ["created", "SCRUM-2"],
    ]);
    const story = jira.issues.get("SCRUM-2")!;
    expect(story).toMatchObject({
      parent: "SCRUM-1",
      sprints: ["10"],
      type: "Task",
    });
    expect(writes[2]!.note).toBe(
      "Created as Task: project SCRUM has no Story type.",
    );
    expect(jira.sprints[0]).toMatchObject({
      state: "active",
      originBoardId: 1,
    });
    expect(jira.sprints[0]!.goal).toContain(`Amun publication ID: `);
    // Only create and start: never update or close a sprint.
    expect(
      jira.calls.filter((c) => c.startsWith("executeDestructive")),
    ).toEqual([
      "executeDestructive:manageJiraSprint:create",
      "executeDestructive:manageJiraSprint:start",
    ]);
    expect(writes[0]!.url).toBe(
      "https://acme.atlassian.net/jira/software/projects/SCRUM/boards/1",
    );
    expect(writes[1]!.url).toBe("https://acme.atlassian.net/browse/SCRUM-1");
  });

  it("publishes nothing before the captain's approval", async () => {
    const id = propose("jira", [{ summary: "Story", fields: { ...site } }]);
    await publisher.publish(id);
    expect(jira.calls).toEqual([]);
    expect(publisher.writes(id)).toEqual([]);
  });

  it("uses the approved items, not a later edit", async () => {
    const id = propose("jira", [
      { summary: "Approved title", fields: { ...site } },
    ]);
    approve(id);
    db.prepare("UPDATE work_plans SET items_json=? WHERE id=?").run(
      JSON.stringify([
        {
          id: uuid(1),
          summary: "Edited",
          fields: { ...site, project: "OTHER" },
        },
      ]),
      id,
    );
    await publisher.publish(id);
    expect([...jira.issues.values()].map((i) => i.summary)).toEqual([
      "Approved title",
    ]);
  });

  it("refuses a site the connection cannot reach before sending anything", async () => {
    const id = propose("jira", [
      {
        summary: "Story",
        fields: { site: "other.atlassian.net", project: "SCRUM" },
      },
    ]);
    approve(id);
    await publisher.publish(id);
    expect(jira.calls).not.toContain("createJiraIssue");
    expect(publisher.writes(id)[0]!.note).toMatch(
      /cannot reach other\.atlassian\.net/,
    );
    expect(plan(id).state).toBe("failed");
  });

  it("is blocked when Jira is not connected", async () => {
    connected.delete("jira");
    const id = propose("jira", [{ summary: "Story", fields: { ...site } }]);
    approve(id);
    await publisher.publish(id);
    expect(jira.calls).toEqual([]);
    expect(publisher.writes(id)[0]!.note).toBe(
      "Connect Jira in Settings, then retry. Nothing was sent.",
    );
  });

  it("finds an issue whose answer was lost instead of creating it twice, even with a lagging index", async () => {
    jira.lose.add("createJiraIssue");
    jira.searchLag = 2;
    const id = propose("jira", [
      { summary: "Lost reply", fields: { ...site } },
    ]);
    approve(id);
    await publisher.publish(id);
    expect(jira.issues.size).toBe(1);
    const write = publisher.writes(id)[0]!;
    expect(write).toMatchObject({
      state: "created",
      externalId: "SCRUM-1",
      attempts: 1,
    });
    expect(write.note).toMatch(/linked, not created again/);
  });

  it("links the earliest of duplicates and names the rest", async () => {
    const id = propose("jira", [{ summary: "Twice", fields: { ...site } }]);
    approve(id);
    const marker = "11111111-1111-4111-8111-111111111111";
    db.prepare(
      "INSERT INTO plan_writes(plan_id,item_id,marker,destination,state,attempts) VALUES (?,?,?,?,'sent',1)",
    ).run(id, uuid(1), marker, "jira");
    for (const key of ["SCRUM-5", "SCRUM-3"])
      jira.issues.set(key, {
        key,
        summary: "Twice",
        type: "Task",
        parent: null,
        labels: [markerLabel(marker)],
        sprints: [],
      });
    await publisher.publish(id, { reconcileOnly: true });
    const write = publisher.writes(id)[0]!;
    expect(write.externalId).toBe("SCRUM-3");
    expect(write.note).toMatch(/SCRUM-5 carries the same Amun marker/);
    expect(jira.calls).not.toContain("createJiraIssue");
  });

  it("reports a parent Jira did not keep instead of claiming it", async () => {
    jira.dropParent = true;
    const id = propose("jira", [
      {
        summary: "Child",
        fields: { type: "Task", ...site, parent: "SCRUM-99" },
      },
    ]);
    approve(id);
    await publisher.publish(id);
    expect(publisher.writes(id)[0]!.note).toBe(
      "Created as SCRUM-1, but parent SCRUM-99 not confirmed.",
    );
  });

  it("does not create a child whose parent failed", async () => {
    const id = propose("jira", [
      {
        summary: "Bad epic",
        fields: { type: "Epic", site: "acme.atlassian.net", project: "NOPE" },
      },
      { summary: "Child", fields: { ...site, parent: "Bad epic" } },
    ]);
    approve(id);
    await publisher.publish(id);
    const [epic, child] = publisher.writes(id);
    expect(epic!.note).toMatch(
      /^Jira refused it: project NOPE is not on acme\.atlassian\.net/,
    );
    expect(child!.note).toMatch(
      /the item it belongs to \(Bad epic\) was not created/,
    );
    expect(jira.issues.size).toBe(0);
    expect(plan(id).state).toBe("failed");
  });

  it("refuses a sprint without dates to start, or without its board", () => {
    const item = (fields: Record<string, string>) => ({
      id: uuid(1),
      summary: "S",
      fields,
      marker: "m",
      destination: "jira",
    });
    expect(() =>
      trackerStep("jira", item({ type: "Sprint", ...site })),
    ).toThrow(/board number/);
    expect(() =>
      trackerStep(
        "jira",
        item({ type: "Sprint", ...site, board: "1", "start sprint": "yes" }),
      ),
    ).toThrow(/both dates/);
    expect(() =>
      trackerStep("jira", item({ type: "Story", site: "acme.atlassian.net" })),
    ).toThrow(/Jira project/);
  });
});

describe("Linear: projects, issues and cycles from an approved plan", () => {
  it("creates the epic as a project, a story in it and a sub-story under the story", async () => {
    const id = propose("linear", [
      { summary: "Onboarding", fields: { type: "Epic", ...workspace } },
      {
        summary: "Sign up",
        fields: {
          type: "Story",
          ...workspace,
          parent: "Onboarding",
          cycle: "3",
          acceptance: "- Email confirmed",
        },
      },
      {
        summary: "Password rules",
        fields: { type: "Story", ...workspace, parent: "Sign up" },
      },
    ]);
    approve(id);
    await publisher.publish(id);
    expect(publisher.writes(id).map((w) => [w.externalId, w.note])).toEqual([
      ["P-TRA-1", null],
      ["TRA-2", null],
      ["TRA-3", null],
    ]);
    expect(linear.issues.get("TRA-2")).toMatchObject({
      projectId: "uuid-P-TRA-1",
      cycleId: "cycle-uuid",
    });
    expect(linear.issues.get("TRA-2")!.description).toContain(
      "## Acceptance criteria\n\n- Email confirmed",
    );
    expect(linear.issues.get("TRA-3")!.parentId).toBe("TRA-2");
  });

  it("refuses to create a cycle and says why, without sending anything", async () => {
    const id = propose("linear", [
      { summary: "Cycle 9", fields: { type: "Sprint", ...workspace } },
    ]);
    approve(id);
    await publisher.publish(id);
    expect(linear.calls).toEqual([]);
    expect(publisher.writes(id)[0]!.note).toMatch(
      /cannot create or start cycles/,
    );
  });

  it("refuses another workspace or a cycle that does not exist", async () => {
    const id = propose("linear", [
      { summary: "Elsewhere", fields: { site: "other", team: "TRA" } },
      { summary: "No cycle", fields: { ...workspace, cycle: "42" } },
    ]);
    approve(id);
    await publisher.publish(id);
    const [a, b] = publisher.writes(id);
    expect(a!.note).toMatch(/workspace acme, not other/);
    expect(b!.note).toMatch(/no cycle 42/);
    expect(linear.calls).not.toContain("save_issue");
  });

  it("finds an issue whose answer was lost", async () => {
    linear.lose.add("save_issue");
    const id = propose("linear", [
      { summary: "Lost", fields: { ...workspace } },
    ]);
    approve(id);
    await publisher.publish(id);
    expect(linear.issues.size).toBe(1);
    expect(publisher.writes(id)[0]).toMatchObject({
      externalId: "TRA-1",
      attempts: 1,
    });
  });
});

describe("the tracker service", () => {
  const service = () =>
    new TrackerService(db, store, {
      workspace: "amun",
      root: "/unused",
      secrets: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
      },
      registerSecret: () => {},
      wait: noWait,
      host: {
        status: async (provider) => ({
          provider,
          status: connected.has(provider) ? "configured" : "missing",
          identity: null,
          message: null,
        }),
        connect: async (provider) => ({
          provider,
          status: "ready",
          identity: null,
          message: null,
        }),
        disconnect: async (provider) => ({
          provider,
          status: "missing",
          identity: null,
          message: null,
        }),
        cancel: () => {},
        use: (provider, work) => access.use(provider, work),
        stop: () => {},
      },
    });

  it("publishes only Linear and Jira plans", async () => {
    const trackers = service();
    const other = propose("ado", [{ summary: "Azure item", fields: {} }]);
    approve(other);
    expect(trackers.owns(other)).toBe(false);
    expect(await trackers.publish(other)).toEqual([]);
    expect(
      await trackers.handle({ action: "publish", planId: other }),
    ).toMatchObject({ handled: false });
    const mine = propose("jira", [{ summary: "Story", fields: { ...site } }]);
    approve(mine);
    expect(
      await trackers.handle({ action: "publish", planId: mine }),
    ).toMatchObject({ handled: true });
    expect(plan(mine).state).toBe("published");
  });

  it("after a restart, looks up a write that was sent and never confirmed, and sends nothing new", async () => {
    const trackers = service();
    const id = propose("jira", [
      { summary: "Sent before the crash", fields: { ...site } },
      { summary: "Never sent", fields: { ...site } },
    ]);
    approve(id);
    db.prepare(
      "INSERT INTO plan_writes(plan_id,item_id,marker,destination,state,attempts) VALUES (?,?,?,?,'sent',1)",
    ).run(id, uuid(1), "22222222-2222-4222-8222-222222222222", "jira");
    jira.issues.set("SCRUM-40", {
      key: "SCRUM-40",
      summary: "Sent before the crash",
      type: "Task",
      parent: null,
      labels: [markerLabel("22222222-2222-4222-8222-222222222222")],
      sprints: [],
    });
    await trackers.recover();
    const [found, never] = trackers.writes(id);
    expect(found).toMatchObject({ state: "created", externalId: "SCRUM-40" });
    expect(never!.state).toBe("pending");
    expect(jira.calls).not.toContain("createJiraIssue");
  });

  it("refuses an unknown provider", async () => {
    await expect(
      service().handle({ action: "status", provider: "asana" }),
    ).rejects.toThrow("Choose Linear or Jira");
  });
});
