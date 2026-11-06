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
): Promise<{ endpoint: "verified" | "unknown"; worker: "unknown" }> {
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
    return {
      endpoint: matchOwnedEndpoint(receipt.identity, record, live),
      worker: "unknown",
    };
  } catch {
    return unknown;
  }
}
