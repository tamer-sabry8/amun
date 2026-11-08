import { it, expect } from "vitest";
import { matchesCandidatePane } from "../src/herdr-candidate.ts";
const receipt = {
  task: "verify-codex",
  worktree: "/private/tmp/lab/codex",
  harness: "codex",
  session: "fm-lab-amun-test",
  generation: "s123.456",
  pane: "w1:p2",
  workspace: "w1",
  tab: "w1:t1",
  terminal: "terminal-2",
  scope: "/private/tmp/lab",
  home: "/private/tmp/lab/primary",
  socketDevice: 1,
  socketInode: 2,
} as const;
const fields = {
  harness: "codex",
  kind: "secondmate",
  backend: "herdr",
  spawn_gen: receipt.generation,
  worktree: receipt.worktree,
  herdr_session: receipt.session,
  herdr_pane_id: receipt.pane,
  herdr_tab_id: receipt.tab,
  herdr_workspace_id: receipt.workspace,
  window: receipt.session + ":" + receipt.pane,
};
const pane = {
  pane_id: receipt.pane,
  workspace_id: receipt.workspace,
  tab_id: receipt.tab,
  terminal_id: receipt.terminal,
  cwd: receipt.worktree,
};
it("requires the original Firstmate generation, named session, worktree and terminal", () => {
  const metadata = (x: Record<string, string>) =>
    Object.entries(x)
      .map(([k, v]) => k + "=" + v)
      .join("\n");
  expect(matchesCandidatePane(receipt, metadata(fields), pane)).toBe(true);
  for (const k of Object.keys(fields))
    expect(
      matchesCandidatePane(
        receipt,
        metadata({ ...fields, [k]: "different" }),
        pane,
      ),
    ).toBe(false);
  for (const k of Object.keys(pane))
    expect(
      matchesCandidatePane(receipt, metadata(fields), {
        ...pane,
        [k]: "different",
      }),
    ).toBe(false);
  expect(
    matchesCandidatePane(receipt, metadata(fields) + "\nbackend=herdr", pane),
  ).toBe(false);
});
