import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { _electron as electron, expect } from "@playwright/test";
import { observeOwnedTmux } from "../packages/crew/src/observe-owned-tmux.ts";
import { loadEndpointReceipt } from "../packages/crew/src/endpoint-receipt.ts";
const descriptor = process.argv[2];
if (!descriptor) throw Error("Pass owned acceptance descriptor");
const setup = JSON.parse(await readFile(descriptor, "utf8")) as {
  scope: string;
};
const receipts = join(setup.scope, "app-data/crew/receipts");
for (const id of ["proof-codex", "proof-claude"])
  if (
    (await observeOwnedTmux(receipts, id, "/opt/homebrew/bin/tmux"))
      .endpoint !== "verified"
  )
    throw Error("Worker identity unavailable");
const receipt = await loadEndpointReceipt(receipts, "proof-codex");
const app = await electron.launch({
  executablePath: resolve(
    `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
  ),
  args: [],
  chromiumSandbox: true,
});
try {
  await expect((await app.firstWindow()).getByRole("status")).toHaveText(
    "Connected",
  );
  const output = (
    await promisify(execFile)("/bin/ps", ["-axo", "pid=,ppid=,rss="], {
      timeout: 10000,
      maxBuffer: 2097152,
    })
  ).stdout;
  const rows = output
    .split("\n")
    .map((s) => s.trim().split(/\s+/).map(Number))
    .filter((r) => r.length === 3 && r.every(Number.isSafeInteger));
  const descendants = (root: number) => {
    const pids = new Set([root]);
    for (let i = 0; i < 32; i++)
      for (const [pid, parent] of rows) if (pids.has(parent!)) pids.add(pid!);
    return rows.filter((r) => pids.has(r[0]!));
  };
  const appRows = descendants(app.process().pid!),
    workerRows = descendants(receipt.identity.serverPid);
  const mib = (rows: number[][]) =>
    Math.round(rows.reduce((sum, r) => sum + r[2]!, 0) / 1024);
  console.log(
    JSON.stringify({
      packaged: true,
      measurement: "ps resident-set sum; shared pages may be double counted",
      appProcessCount: appRows.length,
      appRssMiB: mib(appRows),
      ownedCrewProcessCount: workerRows.length,
      ownedCrewRssMiB: mib(workerRows),
      combinedRssMiB: mib([...appRows, ...workerRows]),
      topology:
        "foundation shell plus existing idle Codex and Claude workers on private tmux; no active Pi inference",
      limitations: [
        "Different sampling/API from Electron working-set baseline; do not subtract the figures",
        "Not peak inference, clean-account or full-product memory",
        "No unrelated personal processes included",
      ],
      crewBudget:
        "observed baseline only; the 500 MiB foundation-shell budget does not cover external workers",
    }),
  );
} finally {
  await app.close();
}
