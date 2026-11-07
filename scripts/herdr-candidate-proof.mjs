// Accept only a newly allocated Amun update lab with already-dispatched workers.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  lstat,
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { userInfo } from "node:os";
import { expect, _electron as electron } from "@playwright/test";
import { herdrCandidateReceipt } from "../packages/contracts/src/herdr-candidate.ts";
const [scope, session, ...tasks] = process.argv.slice(2);
assert.match(scope, /^\/private\/tmp\/amun-firstmate-update-[a-zA-Z0-9]+$/);
assert.match(session, /^fm-lab-amun-[a-z0-9-]+$/);
assert.equal(await realpath(scope), scope);
const owner = await lstat(scope);
assert.equal(owner.uid, process.getuid());
assert.equal(owner.mode & 0o077, 0);
assert.equal(tasks.length, 2);
const userData = await mkdtemp(join(scope, "amun-app-")),
  receipts = join(userData, "candidate-receipts");
await mkdir(receipts, { mode: 0o700 });
const home = join(scope, "candidate"),
  userHome = userInfo().homedir;
const run = async (binary, args) =>
  (
    await promisify(execFile)(binary, args, {
      timeout: 5000,
      maxBuffer: 150000,
    })
  ).stdout;
const herdr = (...args) =>
  run(join(userHome, ".local/bin/herdr"), [...args, "--session", session]);
const sock = await lstat(
  join(userHome, ".config/herdr/sessions", session, "herdr.sock"),
);
assert.ok(sock.isSocket());
const workers = [];
for (const task of tasks) {
  assert.match(task, /^[a-z0-9-]+$/);
  const m = Object.fromEntries(
    (await readFile(join(home, "state", task + ".meta"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );
  assert.equal(m.herdr_session, session);
  assert.equal(dirname(m.worktree), scope);
  assert.match(m.harness, /^(codex|claude)$/);
  const p = JSON.parse(await herdr("agent", "get", m.herdr_pane_id)).result
    .agent;
  assert.equal(p.agent, m.harness);
  const receipt = herdrCandidateReceipt.parse({
    task,
    scope,
    home,
    worktree: m.worktree,
    harness: m.harness,
    session,
    generation: m.spawn_gen,
    pane: p.pane_id,
    workspace: p.workspace_id,
    tab: p.tab_id,
    terminal: p.terminal_id,
    socketDevice: sock.dev,
    socketInode: sock.ino,
  });
  workers.push(receipt);
  await writeFile(join(receipts, task + ".json"), JSON.stringify(receipt), {
    mode: 0o600,
    flag: "wx",
  });
}
assert.deepEqual(workers.map((r) => r.harness).sort(), ["claude", "codex"]);
const identities = async () =>
  Promise.all(
    workers.map(async (r) => {
      const a = JSON.parse(await herdr("agent", "get", r.pane)).result.agent;
      assert.equal(a.agent, r.harness);
      assert.equal(a.cwd, r.worktree);
      assert.equal(a.terminal_id, r.terminal);
      const lsof = await run("/usr/sbin/lsof", [
        "-a",
        "-d",
        "cwd",
        "-Fpc",
        r.worktree,
      ]);
      const expected =
        r.harness === "claude"
          ? basename(await realpath(join(userHome, ".local/bin/claude")))
          : "codex";
      const ids = [...lsof.matchAll(/^p(\d+)\nc([^\n]+)/gm)]
        .filter((m) => m[2] === expected)
        .map((m) => m[1]);
      assert.equal(
        ids.length,
        1,
        "Expected one live " + r.harness + " process",
      );
      return (
        await run("/bin/ps", ["-p", ids[0], "-o", "pid=,lstart=,comm="])
      ).trim();
    }),
  );
const initial = await identities();
const app = await electron.launch({
  args: [
    ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
    "--amun-proof",
    "--amun-herdr-candidate-proof",
    "--user-data-dir=" + userData,
  ],
  ...(process.env.AMUN_PACKAGED_PATH
    ? { executablePath: process.env.AMUN_PACKAGED_PATH }
    : {}),
  chromiumSandbox: true,
});
try {
  assert.equal(
    await app.evaluate(({ app }) => app.getPath("userData")),
    userData,
  );
  const page = await app.firstWindow(),
    connected = page.locator("#service-status");
  const observe = async (id, state) => {
    await page.getByLabel("Firstmate task ID").fill(id);
    await page.getByRole("button", { name: "Observe worker endpoint" }).click();
    await expect(page.locator("#crew-observation")).toHaveText(
      id + ": endpoint " + state + "; worker unknown",
      { timeout: 10000 },
    );
  };
  for (let trial = 0; trial < 10; trial++) {
    await expect(connected).toHaveText("Connected");
    for (const id of tasks) await observe(id, "verified");
    const pid = await app.evaluate(
      ({ app }) =>
        app.getAppMetrics().find((p) => p.name === "Amun Service")?.pid,
    );
    assert.ok(pid);
    process.kill(pid, "SIGKILL");
    await expect
      .poll(() =>
        app.evaluate(
          ({ app }) =>
            app.getAppMetrics().find((p) => p.name === "Amun Service")?.pid ??
            0,
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        app.evaluate(
          ({ app }) =>
            app.getAppMetrics().find((p) => p.name === "Amun Service")?.pid,
        ),
      )
      .not.toBe(pid);
    await expect(connected).toHaveText("Connected", { timeout: 15000 });
    for (const id of tasks) await observe(id, "verified");
    assert.deepEqual(await identities(), initial);
  }
  await observe("missing-candidate", "unknown");
  console.log(
    "Ten isolated service restarts recovered the same two Herdr worker processes and terminals. Missing receipt returned unknown.",
  );
} finally {
  await app.close();
}
