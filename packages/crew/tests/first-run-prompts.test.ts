import { expect, it } from "vitest";
import {
  acceptFirstRunPrompts,
  firstRunPrompt,
} from "../src/first-run-prompts.ts";

const worktree =
  "/private/var/folders/hg/T/amun-live/workspace/firstmate-home-P2Q6HJ/git/codex-worker";
// Captured from a real Codex worker's first run, wrapped as the pane drew it.
const trust = `  Folder access
  /private/var/folders/hg/T/amun-live/workspace/firstmate-home-P2
  Q6HJ/git/codex-worker
  Trust this folder? Codex can read, edit, and run files here, subject to your
  permission settings.
› 1. Trust and continue
  2. Back to Agent Command Center
  enter continue · esc back`;
const hooks = `  Hooks need review
  5 hooks are new or changed.
  Hooks can run outside the sandbox after you trust them.
› 1. Review hooks
  2. Trust all and continue
  3. Continue without trusting (hooks won't run)
  enter confirm · esc skip`;
const working = `• Working (17s • esc to interrupt)
› Ask Codex to do anything`;

it("recognises the folder prompt only for the worker's own worktree", () => {
  expect(firstRunPrompt(trust, worktree)).toEqual({
    step: "trusted-folder",
    keys: ["Enter"],
  });
  // Another folder is never trusted, however the prompt is worded.
  expect(firstRunPrompt(trust, "/Users/someone/Projects/real-repo")).toBeNull();
  expect(
    firstRunPrompt(trust.replace("codex-worker", "something-else"), worktree),
  ).toBeNull();
});

it("answers only when the cursor is on the expected option", () => {
  const moved = trust
    .replace("› 1. Trust and continue", "  1. Trust and continue")
    .replace("  2. Back to", "› 2. Back to");
  expect(firstRunPrompt(moved, worktree)).toBeNull();
  expect(firstRunPrompt(hooks, worktree)).toEqual({
    step: "trusted-hooks",
    keys: ["Down", "Enter"],
  });
  expect(
    firstRunPrompt(
      hooks.replace("  2. Trust all and continue", "  2. Something new"),
      worktree,
    ),
  ).toBeNull();
});

it("leaves every other screen alone, including a sign-in", () => {
  for (const screen of [
    working,
    "",
    "Welcome to Claude Code\n Let's get started.\n ❯ ✔ Dark mode",
    "Sign in with ChatGPT\n› 1. Sign in\n  2. Use an API key",
    "Delete all files?\n› 1. Yes\n  2. No",
  ])
    expect(firstRunPrompt(screen, worktree)).toBeNull();
});

it("checks the worktree before each answer and answers each prompt once", async () => {
  const screens = [trust, trust, hooks, working, working, working, working];
  const sent: string[] = [];
  let checks = 0;
  const taken = await acceptFirstRunPrompts({
    target: "firstmate:fm-amun-codex",
    worktree,
    allow: true,
    waitMs: 1,
    async verify() {
      checks++;
    },
    async tmux(args) {
      if (args[0] === "capture-pane")
        return screens.length > 1 ? screens.shift()! : screens[0]!;
      sent.push(args.at(-1)!);
      // Answering moves the tool on to its next screen.
      if (screens[0] === trust) while (screens[0] === trust) screens.shift();
      else if (screens[0] === hooks) screens.shift();
      return "";
    },
  });
  expect(taken).toEqual({
    taken: ["trusted-folder", "trusted-hooks"],
    blocked: null,
  });
  expect(sent).toEqual(["Enter", "Down", "Enter"]);
  expect(checks).toBe(2);
});

it("answers nothing when the check fails", async () => {
  const sent: string[] = [];
  await expect(
    acceptFirstRunPrompts({
      target: "firstmate:fm-amun-codex",
      worktree,
      allow: true,
      waitMs: 1,
      verify: async () => {
        throw Error("Worktree does not match the selected revision");
      },
      async tmux(args) {
        if (args[0] === "capture-pane") return trust;
        sent.push(args.at(-1)!);
        return "";
      },
    }),
  ).rejects.toThrow("does not match");
  expect(sent).toEqual([]);
});

it("keeps waiting while the tool is still starting, then answers", async () => {
  const starting = "bash-3.2$ export GOTMPDIR=/tmp/fm-amun-codex/gotmp";
  const screens = [
    starting,
    starting,
    starting,
    starting,
    starting,
    starting,
    starting,
    starting,
    starting,
    starting,
    trust,
    working,
    working,
    working,
  ];
  const sent: string[] = [];
  const taken = await acceptFirstRunPrompts({
    target: "firstmate:fm-amun-codex",
    worktree,
    allow: true,
    waitMs: 1,
    verify: async () => undefined,
    async tmux(args) {
      if (args[0] === "capture-pane")
        return screens.length > 1 ? screens.shift()! : screens[0]!;
      sent.push(args.at(-1)!);
      return "";
    },
  });
  expect(taken).toEqual({ taken: ["trusted-folder"], blocked: null });
  expect(sent).toEqual(["Enter"]);
});

it("gives up quietly when there is nothing to answer", async () => {
  const sent: string[] = [];
  const taken = await acceptFirstRunPrompts({
    target: "firstmate:fm-amun-codex",
    worktree,
    allow: true,
    waitMs: 1,
    polls: 12,
    verify: async () => undefined,
    async tmux(args) {
      if (args[0] === "capture-pane") return working;
      sent.push(args.at(-1)!);
      return "";
    },
  });
  expect(taken).toEqual({ taken: [], blocked: null });
  expect(sent).toEqual([]);
});

it("answers nothing until the owner has allowed it, and says what is waiting", async () => {
  const sent: string[] = [];
  let checks = 0;
  const result = await acceptFirstRunPrompts({
    target: "firstmate:fm-amun-codex",
    worktree,
    allow: false,
    waitMs: 1,
    verify: async () => {
      checks++;
    },
    async tmux(args) {
      if (args[0] === "capture-pane") return trust;
      sent.push(args.at(-1)!);
      return "";
    },
  });
  expect(result).toEqual({ taken: [], blocked: "trusted-folder" });
  expect(sent).toEqual([]);
  expect(checks).toBe(0);
});
