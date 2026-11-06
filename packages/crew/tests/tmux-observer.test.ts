import { it, expect } from "vitest";
import {
  parseFirstmateRecord,
  matchOwnedEndpoint,
} from "../src/tmux-observer.ts";
const endpoint = {
  taskId: "proof-1",
  window: "firstmate:fm-proof-1",
  worktree: "/private/tmp/proof/work",
  spawnGeneration: "abc.1",
  paneId: "%1",
  windowId: "@1",
  serverPid: 123,
  panePid: 456,
  ownerToken: "a".repeat(32),
};
const meta = `window=${endpoint.window}\nendpoint_task_id=proof-1\nworktree=${endpoint.worktree}\nspawn_gen=abc.1\nharness=codex\n`;
const live = {
  paneId: "%1",
  windowId: "@1",
  serverPid: 123,
  panePid: 456,
  worktree: endpoint.worktree,
  ownerToken: endpoint.ownerToken,
  dead: false,
};
it("reads upstream tmux metadata without evaluating it", () => {
  expect(parseFirstmateRecord(meta)).toMatchObject({
    backend: "tmux",
    taskId: "proof-1",
    window: endpoint.window,
    worktree: endpoint.worktree,
    spawnGeneration: "abc.1",
    harness: "codex",
  });
  expect(() => parseFirstmateRecord(meta + "backend=herdr\n")).toThrow();
  expect(() => parseFirstmateRecord(meta + "window=other\n")).toThrow();
  expect(() =>
    parseFirstmateRecord(meta.replace("abc.1", "$(touch /tmp/not-executed)")),
  ).toThrow();
  expect(() => parseFirstmateRecord("x".repeat(65537))).toThrow();
});
it("observes the same endpoint only when task, generation, ownership and live identity all match", () => {
  expect(matchOwnedEndpoint(endpoint, parseFirstmateRecord(meta), live)).toBe(
    "verified",
  );
  for (const changed of [
    { ownerToken: "other" },
    { paneId: "%2" },
    { windowId: "@2" },
    { panePid: 457 },
    { serverPid: 124 },
    { worktree: "/other" },
    { dead: true },
  ])
    expect(
      matchOwnedEndpoint(endpoint, parseFirstmateRecord(meta), {
        ...live,
        ...changed,
      }),
    ).toBe("unknown");
  for (const changed of [
    { taskId: "other" },
    { window: "firstmate:other" },
    { worktree: "/other" },
    { spawnGeneration: "abc.2" },
  ])
    expect(
      matchOwnedEndpoint(
        endpoint,
        { ...parseFirstmateRecord(meta), ...changed },
        live,
      ),
    ).toBe("unknown");
  expect(
    matchOwnedEndpoint(endpoint, parseFirstmateRecord(meta), undefined),
  ).toBe("unknown");
});

it("queries only a scoped socket and returns unknown on ambiguous or malformed pane inventory", async () => {
  const { queryTmuxEndpoint } = await import("../src/tmux-observer.ts");
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return args.includes("show-options")
      ? "a".repeat(32) + "\n"
      : "%1|@1|123|456|/private/tmp/proof/work|0\n";
  };
  expect(
    await queryTmuxEndpoint("/private/tmp/scope/socket", "%1", run),
  ).toEqual(live);
  expect(calls.map((args) => args[2])).toEqual(["show-options", "list-panes"]);
  expect(
    calls.every(
      (args) => args[0] === "-S" && args[1] === "/private/tmp/scope/socket",
    ),
  ).toBe(true);
  expect(
    await queryTmuxEndpoint(
      "/private/tmp/scope/socket",
      "%1",
      async () => "malformed",
    ),
  ).toBeUndefined();
  expect(
    await queryTmuxEndpoint("/private/tmp/scope/socket", "%1", async () => {
      throw new Error("unavailable");
    }),
  ).toBeUndefined();
});
