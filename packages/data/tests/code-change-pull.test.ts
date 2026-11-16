import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/database.ts";
import { hashDiff } from "../src/code-change.ts";
import {
  branchName,
  CodeWorkspace,
  type Run,
} from "../../../apps/desktop/src/code-workspace.ts";
import {
  CodeChanges,
  describeChange,
} from "../../../apps/desktop/src/code-change.ts";
import {
  canWrite,
  cannotWrite,
  type CodeHost,
} from "../../../apps/desktop/src/github-code.ts";

const TOKEN = "ghp_secret_token_value";
const diff = "diff --git a/a.txt b/a.txt\n+hello\n";
const REPO = "https://github.com/octo/widgets";
const JOB = "11111111-1111-1111-1111-111111111111";
let root: string;
let db: Database.Database;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "amun-code-"));
  db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p1",
    "P",
    "now",
  );
});
afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

function setup(
  access: Partial<Awaited<ReturnType<CodeHost["access"]>>> = {},
  host: Partial<CodeHost> = {},
) {
  const said: string[] = [];
  let current = diff;
  const workspace = {
    prepare: vi.fn(async (i: { id: string }) => ({
      worktree: join(root, "code", i.id, "worktree"),
    })),
    collect: vi.fn(async () => ({
      ok: true as const,
      empty: false as const,
      files: [
        { path: "a.txt", status: "added" as const, additions: 1, deletions: 0 },
      ],
      diff: current,
      diffHash: hashDiff(current),
      baseSha: "b".repeat(40),
    })),
    commit: vi.fn(async () => "c".repeat(40)),
    remoteHead: vi.fn(async () => undefined as string | undefined),
    push: vi.fn(async () => undefined),
  };
  const github: CodeHost = {
    viewer: async () => ({ login: "me", name: "Me", email: "me@x.test" }),
    access: async () => ({
      defaultBranch: "main",
      private: true,
      canPush: true,
      scopes: ["repo"],
      ...access,
    }),
    findPull: vi.fn(async () => undefined),
    createPull: vi.fn(async () => ({ number: 7, url: REPO + "/pull/7" })),
    ...host,
  };
  const changes = new CodeChanges({
    db,
    root,
    workspace: workspace as unknown as CodeWorkspace,
    host: () => github,
    tokens: async () => [TOKEN],
    say: (_area, text) => said.push(text),
    revise: vi.fn(async () => undefined),
  });
  return {
    changes,
    workspace,
    github,
    said,
    edit: (next: string) => (current = next),
  };
}
async function propose(s: ReturnType<typeof setup>) {
  const { meta } = await s.changes.prepare({
    product: "p1",
    workAreaId: "a1",
    agent: "Claude",
    title: "Fix widget",
    repo: REPO,
  });
  await s.changes.submit(meta.id, "Title: Fix the widget\nMakes it work.");
  const [card] = await s.changes.cards("p1");
  return { meta, card: card! };
}

it("shows the exact change and binds approval to its hash, branch, base and repo", async () => {
  const s = setup();
  const { meta, card } = await propose(s);
  expect(card).toMatchObject({
    repo: { owner: "octo", name: "widgets" },
    base: "main",
    branch: meta.branch,
    diff,
    diffHash: hashDiff(diff),
    state: "waiting",
  });
  expect(card.message).toBe("Fix the widget\n\nMakes it work.");
  expect(card.branch).toMatch(/^amun\//);
  s.edit(diff + "+sneaky\n");
  await expect(s.changes.approve("p1", card.id, card.binding)).rejects.toThrow(
    /updated/,
  );
  expect(s.workspace.push).not.toHaveBeenCalled();
  expect(s.github.createPull).not.toHaveBeenCalled();
  expect((await s.changes.cards("p1"))[0]!.state).toBe("declined");
});

it("refuses a wrong binding without sending anything", async () => {
  const s = setup();
  const { card } = await propose(s);
  await expect(
    s.changes.approve("p1", card.id, "0".repeat(64)),
  ).rejects.toThrow();
  expect(s.workspace.push).not.toHaveBeenCalled();
});

it("blocks approval when the sign-in cannot write", async () => {
  const s = setup({ scopes: ["public_repo"] });
  const { card } = await propose(s);
  expect(card.blocker).toBe(cannotWrite("octo/widgets"));
  expect(card.blocker).toBe(
    "Amun's GitHub sign-in can't write to octo/widgets. Reconnect GitHub with access to private repositories in Settings › Tools.",
  );
  await expect(s.changes.approve("p1", card.id, card.binding)).rejects.toThrow(
    /can't write/,
  );
  expect(s.workspace.commit).not.toHaveBeenCalled();
  expect(s.workspace.push).not.toHaveBeenCalled();
});

it("pushes a new branch, opens one pull request and records the receipt", async () => {
  const s = setup();
  const { meta, card } = await propose(s);
  const text = await s.changes.approve("p1", card.id, card.binding);
  expect(text).toBe(`Pull request #7 is open: ${REPO}/pull/7`);
  expect(s.workspace.push).toHaveBeenCalledWith(
    meta.id,
    meta.branch,
    "main",
    TOKEN,
  );
  const body = (s.github.createPull as ReturnType<typeof vi.fn>).mock
    .calls[0]![0];
  expect(body).toMatchObject({ head: meta.branch, base: "main" });
  expect(body.body).toContain("opened by Amun after owner approval");
  expect(body.body).toContain("Files: a.txt (+1)");
  expect(body.body).toContain(`Branch: ${meta.branch} from main`);
  expect(body.body).toContain("Nothing is merged.");
  expect(body.body).not.toMatch(/uncommitted|did not commit/i);
  expect(card.body).toBe(body.body.split("\n\n").slice(0, -1).join("\n\n"));
  expect(body.body).toContain("amun-code-change:" + card.id);
  const [done] = await s.changes.cards("p1");
  expect(done).toMatchObject({
    state: "open",
    pull: { number: 7, commit: "c".repeat(40) },
  });
  expect(s.said.at(-1)).toBe(text);
  await s.changes.approve("p1", card.id, card.binding);
  expect(s.github.createPull).toHaveBeenCalledTimes(1);
  expect(s.workspace.push).toHaveBeenCalledTimes(1);
});

it("links a pull request that already exists for the branch", async () => {
  const s = setup(
    {},
    { findPull: vi.fn(async () => ({ number: 3, url: REPO + "/pull/3" })) },
  );
  const { card } = await propose(s);
  expect(await s.changes.approve("p1", card.id, card.binding)).toContain("#3");
  expect(s.github.createPull).not.toHaveBeenCalled();
  expect(s.workspace.push).not.toHaveBeenCalled();
});

it("after a push whose pull request call failed, looks it up and never pushes again", async () => {
  let fail = true;
  const s = setup(
    {},
    {
      createPull: vi.fn(async () => {
        if (fail) throw Error("response lost");
        return { number: 9, url: REPO + "/pull/9" };
      }),
    },
  );
  const { card } = await propose(s);
  await expect(s.changes.approve("p1", card.id, card.binding)).rejects.toThrow(
    /couldn't confirm/,
  );
  expect((await s.changes.cards("p1"))[0]!.state).toBe("unconfirmed");
  expect(s.workspace.push).toHaveBeenCalledTimes(1);
  s.workspace.remoteHead.mockResolvedValue("c".repeat(40));
  fail = false;
  expect(await s.changes.approve("p1", card.id, card.binding)).toContain("#9");
  expect(s.workspace.push).toHaveBeenCalledTimes(1);
  expect(s.workspace.commit).toHaveBeenCalledTimes(1);
});

it("leaves a branch on GitHub alone when it is not the one that was sent", async () => {
  const s = setup(
    {},
    {
      createPull: vi.fn(async () => {
        throw Error("lost");
      }),
    },
  );
  const { card } = await propose(s);
  await expect(
    s.changes.approve("p1", card.id, card.binding),
  ).rejects.toThrow();
  s.workspace.remoteHead.mockResolvedValue("d".repeat(40));
  await expect(s.changes.approve("p1", card.id, card.binding)).rejects.toThrow(
    /left it alone/,
  );
  expect(s.workspace.push).toHaveBeenCalledTimes(1);
});

it("sends nothing when the branch name is already taken by other work", async () => {
  const s = setup();
  const { card } = await propose(s);
  s.workspace.remoteHead.mockResolvedValue("d".repeat(40));
  await expect(s.changes.approve("p1", card.id, card.binding)).rejects.toThrow(
    /different work/,
  );
  expect(s.workspace.push).not.toHaveBeenCalled();
  expect((await s.changes.cards("p1"))[0]!.state).toBe("failed");
});

it("judges write access from permissions and scopes", () => {
  const base = { defaultBranch: "main", private: true, canPush: true };
  expect(canWrite({ ...base, scopes: ["repo"] })).toBe(true);
  expect(canWrite({ ...base, scopes: ["public_repo"] })).toBe(false);
  expect(canWrite({ ...base, private: false, scopes: ["public_repo"] })).toBe(
    true,
  );
  expect(canWrite({ ...base, scopes: null })).toBe(true);
  expect(canWrite({ ...base, canPush: false, scopes: ["repo"] })).toBe(false);
});

it("takes the title from the crewmate's first line and falls back to the job name", () => {
  expect(describeChange("Job", "Title: Better\nMore").title).toBe("Better");
  expect(describeChange("Job", "").message).toBe("Job");
});

function recorder(branch: string) {
  const calls: { args: string[]; env: Record<string, string> }[] = [];
  const run: Run = async (args, { env }) => {
    calls.push({ args, env: env ?? {} });
    if (args.includes("--show-toplevel"))
      return join(root, "code", JOB, "worktree");
    if (args.includes("--git-common-dir"))
      return join(root, "code", JOB, "repo", ".git");
    if (args.includes("--show-current")) return branch;
    if (args.includes("push")) throw Error("denied for " + TOKEN);
    return "";
  };
  return { calls, run };
}
async function folders() {
  await mkdir(join(root, "code", JOB, "worktree"), { recursive: true });
  await mkdir(join(root, "code", JOB, "repo", ".git"), { recursive: true });
}

it("keeps the token out of every argument and error, and only in the push's environment", async () => {
  const branch = "amun/fix-abc123";
  await folders();
  const { calls, run } = recorder(branch);
  const error = await new CodeWorkspace(root, run)
    .push(JOB, branch, "main", TOKEN)
    .catch((e: Error) => e);
  expect((error as Error).message).not.toContain(TOKEN);
  for (const call of calls) {
    expect(call.args.join(" ")).not.toContain(TOKEN);
    expect(call.args.join(" ")).not.toMatch(/--force|\s-f\s|\+refs/);
  }
  const pushed = calls.find((c) => c.args.includes("push"))!;
  expect(pushed.env.AMUN_GIT_TOKEN).toBe(TOKEN);
  expect(pushed.args).toContain(`refs/heads/${branch}:refs/heads/${branch}`);
  expect(
    calls.filter((c) => c !== pushed).every((c) => !c.env.AMUN_GIT_TOKEN),
  ).toBe(true);
});

it("never pushes the default branch or a branch Amun did not create", async () => {
  const { calls, run } = recorder("main");
  const workspace = new CodeWorkspace(root, run);
  for (const branch of ["main", "feature/x", "master"])
    await expect(workspace.push(JOB, branch, "main", TOKEN)).rejects.toThrow(
      /own new branches/,
    );
  await expect(
    workspace.push(JOB, "amun/main", "amun/main", TOKEN),
  ).rejects.toThrow(/own new branches/);
  expect(calls).toHaveLength(0);
  expect(branchName("Fix: the Widget!", JOB)).toBe(
    "amun/fix-the-widget-111111",
  );
});

it("copies over https only, without hooks or stored credentials", async () => {
  const branch = "amun/fix-abc123";
  await folders();
  const { calls, run } = recorder(branch);
  const workspace = new CodeWorkspace(root, run);
  const input = {
    id: JOB,
    origin: "https://github.com",
    owner: "octo",
    repo: "widgets",
    base: "main",
    branch,
    token: TOKEN,
  };
  await workspace.prepare(input);
  const clone = calls.find((c) => c.args.includes("clone"))!;
  expect(clone.args).toContain("https://github.com/octo/widgets.git");
  expect(clone.args).toEqual(
    expect.arrayContaining(["--depth", "1", "core.symlinks=false"]),
  );
  expect(clone.args.some((a) => a.startsWith("core.hooksPath="))).toBe(true);
  expect(calls.some((c) => c.args.join(" ").includes(TOKEN))).toBe(false);
  expect(
    calls.some((c) => c.args.includes("worktree") && c.args.includes("-b")),
  ).toBe(true);
  await expect(
    workspace.prepare({ ...input, origin: "http://github.com" }),
  ).rejects.toThrow();
});
