import { ownedWorktreeBranch } from "./firstmate-worktree.ts";
import { observedRun } from "./observed-run.ts";
import type { Run } from "../../contracts/src/entities.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  loadEndpointReceipt,
  readBoundedPrivateFile,
} from "./endpoint-receipt.ts";
import {
  parseFirstmateRecord,
  queryTmuxEndpoint,
  matchOwnedEndpoint,
} from "./tmux-observer.ts";
/** Read-only recovery: no create-session, send-keys, ownership changes or worker dispatch. */
export async function observeOwnedTmux(
  receiptRoot: string,
  taskId: string,
  tmuxBinary: string,
  productId?: string,
): Promise<{ endpoint: "verified" | "unknown"; worker: "unknown"; run?: Run }> {
  const unknown = { endpoint: "unknown", worker: "unknown" } as const;
  try {
    if (!tmuxBinary.startsWith("/")) return unknown;
    const receipt = await loadEndpointReceipt(receiptRoot, taskId);
    for (const directory of [
      receipt.home,
      join(receipt.home, "state"),
      receipt.scope,
    ]) {
      const entry = await lstat(directory);
      if (
        (await realpath(directory)) !== directory ||
        !entry.isDirectory() ||
        entry.uid !== process.getuid?.() ||
        (entry.mode & 0o077) !== 0
      )
        return unknown;
    }
    const socket = await lstat(receipt.socket);
    if (
      !socket.isSocket() ||
      socket.uid !== process.getuid?.() ||
      (await realpath(receipt.socket)) !== receipt.socket
    )
      return unknown;
    const record = parseFirstmateRecord(
      await readBoundedPrivateFile(
        join(receipt.home, "state", taskId + ".meta"),
        65536,
      ),
    );
    const live = await queryTmuxEndpoint(
      receipt.socket,
      receipt.identity.paneId,
      async (args) =>
        (
          await promisify(execFile)(tmuxBinary, args, {
            env: { PATH: "/usr/bin:/bin" },
            timeout: 3000,
            maxBuffer: 65536,
          })
        ).stdout,
    );
    const endpoint = matchOwnedEndpoint(receipt.identity, record, live);
    if (endpoint !== "verified") return unknown;
    const branch = await ownedWorktreeBranch(receipt.home, record.worktree);
    if (!productId) return { endpoint, worker: "unknown" };
    return {
      endpoint,
      worker: "unknown",
      run: observedRun(productId, record, branch),
    };
  } catch {
    return unknown;
  }
}

type TmuxRun = (args: string[]) => Promise<string>;
/**
 * Whether the worker a receipt names is positively gone. "gone" only when its
 * own tmux server is not running, or answers and no longer has that pane (or
 * it is dead, or a different server now holds that pane number). Anything
 * unclear is "unknown", so a worker that may still be alive is never
 * replaced. Read-only.
 */
export async function endpointPresence(
  receiptRoot: string,
  taskId: string,
  tmuxBinary: string,
  run: TmuxRun = async (args) =>
    (
      await promisify(execFile)(tmuxBinary, args, {
        env: { PATH: "/usr/bin:/bin" },
        timeout: 3000,
        maxBuffer: 65536,
      })
    ).stdout,
): Promise<"none" | "gone" | "present" | "unknown"> {
  let receipt;
  try {
    receipt = await loadEndpointReceipt(receiptRoot, taskId);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? "none" : "unknown";
  }
  if (!tmuxBinary.startsWith("/") || !receipt.socket.startsWith("/"))
    return "unknown";
  try {
    await lstat(receipt.socket);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? "gone" : "unknown";
  }
  try {
    const token = (
      await run(["-S", receipt.socket, "show-options", "-gqv", "@amun-owner"])
    ).trim();
    if (token !== receipt.identity.ownerToken) return "unknown";
    const rows = (
      await run([
        "-S",
        receipt.socket,
        "list-panes",
        "-a",
        "-F",
        "#{pane_id}|#{pid}|#{pane_dead}",
      ])
    )
      .trim()
      .split("\n")
      .map((line) => line.split("|"))
      .filter((fields) => fields[0] === receipt.identity.paneId);
    if (!rows.length) return "gone";
    if (rows.length > 1) return "unknown";
    const [, server, dead] = rows[0]!;
    return server !== String(receipt.identity.serverPid) || dead === "1"
      ? "gone"
      : "present";
  } catch (e) {
    const said = String((e as { stderr?: unknown }).stderr ?? e);
    return /no server running|error connecting|connection refused/i.test(said)
      ? "gone"
      : "unknown";
  }
}
