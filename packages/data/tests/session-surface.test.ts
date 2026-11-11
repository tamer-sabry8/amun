import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { Trajectory } from "../src/trajectory.ts";
import { SessionSurface } from "../src/session-surface.ts";
import { GitCheckpoints } from "../src/git-checkpoints.ts";

const setup = () => {
  const db = new Database(":memory:");
  migrate(db);
  const trajectory = new Trajectory(db);
  const session = trajectory.start({ title: "Invite expiry", origin: "pi" });
  trajectory.append(session.id, {
    source: "user",
    kind: "request",
    participant: "chat:tamer",
    summary: "Add invite expiry",
  });
  const call = trajectory.append(session.id, {
    source: "tool",
    kind: "call",
    participant: "engineer",
    summary: "Run tests",
    tool: "bash",
  });
  const ask = trajectory.append(session.id, {
    source: "approval",
    kind: "request",
    participant: "amun",
    summary: "Merge PR 42",
  });
  return {
    db,
    trajectory,
    surface: new SessionSurface(db, trajectory),
    id: session.id,
    call,
    ask,
  };
};

it("shows the same state from chat and from the terminal", () => {
  const { db, surface, id, ask } = setup();
  const state = surface.state(id);
  expect(state).toMatchObject({
    reference: "amun://session/" + id,
    title: "Invite expiry",
    state: "awaiting_approval",
    done: ["User input: Add invite expiry"],
    pending: ["Run tests"],
    failed: [],
    needsDecision: [{ eventId: ask.id, summary: "Merge PR 42" }],
    lastSurface: null,
  });
  const text = surface.cli(["status", state.reference], "tamer");
  expect(text.exitCode).toBe(0);
  expect(text.output).toBe(
    [
      "Invite expiry · awaiting approval",
      "amun://session/" + id,
      "Done:",
      "  - User input: Add invite expiry",
      "Pending:",
      "  - Run tests",
      "Needs a decision:",
      `  - Merge PR 42 (${ask.id})`,
    ].join("\n"),
  );
  expect(
    JSON.parse(surface.cli(["status", id, "--json"], "tamer").output),
  ).toEqual(state);
  db.close();
});

it("records every handoff and action with the surface and person that made it", () => {
  const { db, trajectory, surface, id, ask } = setup();
  const moved = surface.handoff(id, "chat", "cli", "tamer");
  expect(moved).toMatchObject({
    lastSurface: "cli",
    command: "amun session status amun://session/" + id,
  });
  expect(() => surface.handoff(id, "cli", "cli", "tamer")).toThrow(
    /already on that surface/,
  );
  expect(surface.cli(["say", id, "Use", "30", "days"], "tamer")).toEqual({
    exitCode: 0,
    output: "Added as #5",
  });
  expect(surface.cli(["decide", id, "nope", "approve"], "tamer")).toEqual({
    exitCode: 1,
    output: "Error: No open approval request with that id in this session",
  });
  expect(
    surface.cli(["decide", id, ask.id, "approve"], "ci-bot", "automation")
      .output,
  ).toBe("Error: An automation cannot answer an approval; a person must");
  expect(
    surface.cli(["decide", id, ask.id, "approve", "Checks", "green"], "tamer")
      .output,
  ).toBe("Approved: Merge PR 42");
  expect(surface.cli(["decide", id, ask.id, "reject"], "tamer").exitCode).toBe(
    1,
  );
  expect(surface.cli(["open", id], "tamer").output).toBe(
    "Open in chat: amun://session/" + id,
  );
  const events = trajectory
    .events(id)
    .slice(3)
    .map((e) => [e.source, e.kind, e.participant, e.summary]);
  expect(events).toEqual([
    ["system", "handoff", "chat:tamer", "Continued in the terminal"],
    ["user", "request", "cli:tamer", "Use 30 days"],
    ["approval", "granted", "cli:tamer", "Approved: Merge PR 42"],
    ["system", "handoff", "cli:tamer", "Continued in the chat"],
  ]);
  expect(trajectory.events(id).at(-2)).toMatchObject({
    refersTo: ask.id,
    detail: { reason: "Checks green" },
  });
  expect(surface.state(id)).toMatchObject({
    state: "in_progress",
    needsDecision: [],
    lastSurface: "chat",
  });
  expect(trajectory.verify(id)).toBe(true);
  db.close();
});

it("serves people with text and scripts with JSON, and fails with a non-zero exit code", () => {
  const { db, surface, id } = setup();
  expect(
    surface.cli(["events", id, "--source", "tool"], "tamer").output,
  ).toMatch(/^#2 .* \[tool\] engineer: Run tests$/);
  expect(
    JSON.parse(surface.cli(["search", id, "tests", "--json"], "s").output),
  ).toHaveLength(1);
  expect(surface.cli(["search", id, "zzz"], "s").output).toBe(
    "No events match.",
  );
  expect(surface.cli(["ref", id], "s").output).toBe("amun://session/" + id);
  expect(surface.cli([], "s").output).toContain("amun session status <ref>");
  expect(surface.cli(["events", id, "--source", "gossip"], "s")).toEqual({
    exitCode: 1,
    output: 'Error: Unknown source "gossip"',
  });
  expect(
    JSON.parse(surface.cli(["status", "bad", "--json"], "s").output),
  ).toEqual({ error: "That is not a session reference" });
  expect(
    surface.cli(["status", "6b1f02c4-9a3e-4c1d-8f2a-0123456789ab"], "s"),
  ).toEqual({ exitCode: 1, output: "Error: Unknown trajectory session" });
  db.close();
});

it("records where a branch was before an operation and refuses a rollback that would lose newer work", () => {
  const { db } = setup();
  const checkpoints = new GitCheckpoints(db);
  const a = "a".repeat(40),
    b = "b".repeat(40),
    c = "c".repeat(40);
  const rebase = checkpoints.begin("/repo", "feature", "rebase", a);
  checkpoints.finish(rebase.id, b);
  const squash = checkpoints.finish(
    checkpoints.begin("/repo", "feature", "squash", b).id,
    c,
  );
  expect(
    checkpoints.history("/repo", "feature").map((x) => x.operation),
  ).toEqual(["squash", "rebase"]);
  expect(() => checkpoints.rollback(rebase.id, c)).toThrow(
    /roll back the later change first/,
  );
  expect(checkpoints.rollback(squash.id, c)).toBe(b);
  expect(() => checkpoints.rollback(squash.id, c)).toThrow(
    /already rolled back/,
  );
  expect(checkpoints.rollback(rebase.id, b)).toBe(a);
  expect(() =>
    checkpoints.begin("/repo", "feature", "rebase", "short"),
  ).toThrow(/Invalid commit/);
  expect(() => checkpoints.begin(" ", "f", "x", a)).toThrow();
  db.close();
});
