import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listReceiptTasks, loadEndpointReceipt } from "./endpoint-receipt.ts";
import { observeOwnedTmux } from "./observe-owned-tmux.ts";

export const sessionLines = 200;
export const sessionBytes = 32768;

type Observe = typeof observeOwnedTmux;
type Capture = (args: string[]) => Promise<string>;

/** Bounded, control-free and redacted: the last lines of a pane, never raw escapes. */
export function shapeSessionText(
  raw: string,
  redact: (text: string) => string,
): string {
  const cleaned = raw
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+$/, "");
  let text = redact(cleaned.split("\n").slice(-sessionLines).join("\n"));
  if (text.length > sessionBytes) text = text.slice(-sessionBytes);
  return text;
}

/**
 * Read-only capture of the pane for one crewmate. Only tasks that have a
 * receipt in Amun's own crew home and whose live pane still matches the
 * recorded identity are read; any other target yields null.
 */
export async function captureOwnedTmux(
  receiptRoot: string,
  taskId: string,
  tmuxBinary: string,
  redact: (text: string) => string,
  deps: { observe?: Observe; run?: Capture } = {},
): Promise<string | null> {
  try {
    if (!/^[-a-zA-Z0-9_]{1,64}$/.test(taskId) || !tmuxBinary.startsWith("/"))
      return null;
    if (!(await listReceiptTasks(receiptRoot)).includes(taskId)) return null;
    const observed = await (deps.observe ?? observeOwnedTmux)(
      receiptRoot,
      taskId,
      tmuxBinary,
    );
    if (observed.endpoint !== "verified") return null;
    const receipt = await loadEndpointReceipt(receiptRoot, taskId);
    const run =
      deps.run ??
      (async (args) =>
        (
          await promisify(execFile)(tmuxBinary, args, {
            env: { PATH: "/usr/bin:/bin" },
            timeout: 3000,
            maxBuffer: 262144,
          })
        ).stdout);
    const raw = await run([
      "-S",
      receipt.socket,
      "capture-pane",
      "-p",
      "-J",
      "-S",
      "-" + sessionLines,
      "-t",
      receipt.identity.paneId,
    ]);
    return shapeSessionText(raw, redact);
  } catch {
    return null;
  }
}
