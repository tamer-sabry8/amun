// A worker's first run in a new worktree stops at two prompts from its own
// tool: "Trust this folder?" and "Hooks need review". The owner granted
// standing trust for Amun's own disposable worktrees (AGENTS.md, "Firstmate
// homes"), scoped to the individual worktree and only after its identity and
// its hooks have been checked against the selected Firstmate revision.
//
// This answers those two prompts and nothing else. It never types into a
// prompt it does not recognise, never answers for a folder other than the
// worker's own worktree, and never signs a worker in.

/** Runs tmux with these arguments against the crew's private server. */
export type Tmux = (args: string[]) => Promise<string>;
export interface FirstRunInput {
  tmux: Tmux;
  /** The pane the worker runs in, e.g. "firstmate:fm-amun-codex". */
  target: string;
  /** The worker's own worktree: the only folder trust is given for. */
  worktree: string;
  /** Checks the worktree and its hooks against the selected revision. */
  verify(): Promise<void>;
  /** What the tool's screen looks like once it is ready for work. */
  ready?: RegExp;
  polls?: number;
  waitMs?: number;
}
/** The idle prompt of the two worker tools. */
export const workerReady = /Ask Codex to do anything|\? for shortcuts/;
export type FirstRunStep = "trusted-folder" | "trusted-hooks";

const squeeze = (text: string) => text.replace(/\s+/g, "");
/** The option the cursor is on, as the tool draws it: "› 1. Trust and continue". */
const selected = (screen: string) =>
  /^\s*[›❯>]\s*\d+\.\s*(.+?)\s*$/m.exec(screen)?.[1] ?? "";

/** What, if anything, the screen is asking that Amun may answer. */
export function firstRunPrompt(
  screen: string,
  worktree: string,
): { step: FirstRunStep; keys: string[] } | null {
  const on = selected(screen);
  if (
    /Trust this folder\?|Do you trust the files in this folder\?/.test(
      screen,
    ) &&
    // The path is wrapped across lines on a narrow pane.
    squeeze(screen).includes(squeeze(worktree)) &&
    /^(Trust and continue|Yes, (I trust|proceed))/.test(on)
  )
    return { step: "trusted-folder", keys: ["Enter"] };
  if (
    /Hooks need review/.test(screen) &&
    /^\s*2\.\s*Trust all and continue\s*$/m.test(screen) &&
    /^Review hooks/.test(on)
  )
    return { step: "trusted-hooks", keys: ["Down", "Enter"] };
  return null;
}

/**
 * Watches the worker's pane for a short while and answers the two first-run
 * prompts if they appear. Returns what it answered, in order.
 */
export async function acceptFirstRunPrompts(input: FirstRunInput) {
  const taken: FirstRunStep[] = [];
  let quiet = 0;
  for (let poll = 0; poll < (input.polls ?? 60); poll++) {
    let screen = "";
    try {
      screen = await input.tmux(["capture-pane", "-p", "-t", input.target]);
    } catch {
      // The pane is not there yet, or has gone: nothing to answer.
    }
    const prompt = firstRunPrompt(screen, input.worktree);
    if (prompt && !taken.includes(prompt.step)) {
      // Each kind is answered once, and only after the check passes.
      await input.verify();
      for (const key of prompt.keys) {
        await input.tmux(["send-keys", "-t", input.target, key]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      taken.push(prompt.step);
      quiet = 0;
    } else if (!prompt && (input.ready ?? workerReady).test(screen)) {
      // The tool is at its own prompt: nothing more to answer. Seen twice,
      // so a screen caught between two prompts is not mistaken for ready.
      if (++quiet >= 2) break;
    } else quiet = 0;
    await new Promise((resolve) => setTimeout(resolve, input.waitMs ?? 2000));
  }
  return taken;
}
