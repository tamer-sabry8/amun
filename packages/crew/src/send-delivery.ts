import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { FirstmateReleases } from "./firstmate-release.ts";
import { dispatchFirstmate } from "./firstmate-dispatch.ts";
import { loadEndpointReceipt } from "./endpoint-receipt.ts";
import { observeOwnedTmux } from "./observe-owned-tmux.ts";
/** Delivery ids deduplicate the worker inbox entry across service restarts. */
export async function sendDelivery(
  releases: FirstmateReleases,
  receipts: string,
  binary: string,
  harness: "codex" | "claude",
  id: string,
  text: string,
) {
  const { home, revision } = await releases.crewHome();
  await dispatchFirstmate(releases, receipts, binary, {
    harness,
    charter:
      "Read only the active Amun delivery brief. Keep product material inside the selected delivery scope.",
  });
  const task = "amun-" + harness,
    receipt = await loadEndpointReceipt(receipts, task);
  if (
    receipt.home !== home ||
    (await observeOwnedTmux(receipts, task, binary)).endpoint !== "verified"
  )
    throw Error("Worker endpoint unavailable.");
  await releases.verifyHomes(revision, [home]);
  await promisify(execFile)(
    "/bin/bash",
    [
      join(home, "bin", "fm-send.sh"),
      task,
      "--fire-and-forget",
      createHash("sha256").update(id).digest("hex").slice(0, 16),
      text,
    ],
    {
      cwd: home,
      env: {
        HOME: dirname(dirname(home)),
        PATH: dirname(binary) + ":/opt/homebrew/bin:/usr/bin:/bin",
        FM_HOME: home,
        FM_ROOT_OVERRIDE: home,
        FM_BACKEND: "tmux",
        TMUX_TMPDIR: receipt.scope,
      },
      timeout: 60000,
      maxBuffer: 65536,
    },
  );
  return receipt;
}
