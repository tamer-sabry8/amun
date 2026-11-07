import { verifyDisposableWorker } from "./crew-acceptance-worker.ts";
import { test, expect, _electron as electron } from "@playwright/test";
import { chmod, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEndpointReceipt } from "../../packages/crew/src/endpoint-receipt.ts";
async function workerIdentities(pane: number, harness: string) {
  const { stdout } = await promisify(execFile)(
    "/bin/ps",
    ["-axo", "pid=,ppid=,lstart=,comm="],
    { maxBuffer: 2097152 },
  );
  const rows = stdout.split("\n").flatMap((line) => {
    const row = line
      .trim()
      .match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/);
    return row ? [row] : [];
  });
  const descendants = new Set([pane]);
  for (let i = 0; i < 20; i++)
    for (const row of rows)
      if (descendants.has(Number(row[2]))) descendants.add(Number(row[1]));
  const workers = rows.filter(
    (row) =>
      descendants.has(Number(row[1])) && row[4]!.split("/").pop() === harness,
  );
  const workerPids = new Set(workers.map((row) => Number(row[1])));
  const parents = new Map(rows.map((row) => [Number(row[1]), Number(row[2])]));
  // Some CLI workers launch short-lived children using the same executable.
  // Keep each independent worker root so replacement and duplicate spawns still fail.
  return workers
    .filter((row) => {
      let parent = Number(row[2]);
      while (descendants.has(parent)) {
        if (workerPids.has(parent)) return false;
        if (parent === pane) break;
        parent = parents.get(parent) ?? 0;
      }
      return true;
    })
    .map((row) => row[1] + " " + row[3])
    .sort();
}
test("Firstmate dispatches both persistent subscription workers and publishes their real endpoints", async () => {
  test.skip(
    process.env.AMUN_LIVE_CREW_DISPATCH !== "1",
    "Requires the two Amun CLI subscriptions and tmux",
  );
  test.setTimeout(180000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-dispatch-e2e-")),
  );
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const launch = () =>
    electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
    });
  let app = await launch();
  let socket: string | undefined;
  const hooks: string[] = [];
  const identities = new Map<string, string[]>();
  try {
    for (const harness of ["codex", "claude"] as const) {
      const page = await app.firstWindow();
      if (harness === "codex")
        await page.getByRole("button", { name: "Agents", exact: true }).click();
      await page
        .getByLabel("Persistent worker harness")
        .selectOption(harness, { timeout: 2500 });
      await page
        .getByLabel("Worker charter")
        .fill(
          "Acceptance only. Wait for the captain. Do not use tools, contact anyone, edit files or launch agents.",
        );
      await page
        .getByRole("button", {
          name: "Dispatch through Firstmate",
          exact: true,
        })
        .click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Firstmate dispatched " + harness }),
      ).toBeVisible({ timeout: 75000 });
      const receipt = await loadEndpointReceipt(
        join(root, "crew/receipts"),
        "amun-" + harness,
      );
      expect(receipt.home.startsWith(root + "/workspace/firstmate-home-")).toBe(
        true,
      );
      expect(
        await readFile(
          join(receipt.home, "state", "amun-" + harness + ".meta"),
          "utf8",
        ),
      ).toContain("harness=" + harness);
      if (socket) expect(receipt.socket).toBe(socket);
      if (
        (await realpath(receipt.scope)) !== receipt.scope ||
        !/^\/private\/tmp\/amun-tmux-[A-Za-z0-9]{6}$/.test(receipt.scope)
      )
        throw Error("Unexpected test socket scope");
      const { stdout: token } = await promisify(execFile)(
        "/opt/homebrew/bin/tmux",
        ["-S", receipt.socket, "show-options", "-gqv", "@amun-owner"],
      );
      if (token.trim() !== receipt.identity.ownerToken)
        throw Error("Unexpected test socket owner");
      socket = receipt.socket;
      hooks.push(join(receipt.home, "state", "amun-" + harness + ".git-hooks"));
      await expect
        .poll(
          async () =>
            (await workerIdentities(receipt.identity.panePid, harness)).length,
          { timeout: 15000 },
        )
        .toBeGreaterThan(0);
      identities.set(
        harness,
        await workerIdentities(receipt.identity.panePid, harness),
      );
    }
    if (process.env.AMUN_LIVE_CREW_INFERENCE === "1") {
      for (const harness of ["codex", "claude"] as const)
        await verifyDisposableWorker(root, harness);
    }
    await app.close();
    app = await launch();
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    for (const harness of ["codex", "claude"]) {
      await page.getByLabel("Saved workers").selectOption("amun-" + harness);
      await page
        .getByRole("button", { name: "Observe worker", exact: true })
        .click();
      await expect(page.getByTestId("agent-endpoint")).toHaveText(
        "amun-" + harness + " · Endpoint verified",
      );
      const receipt = await loadEndpointReceipt(
        join(root, "crew/receipts"),
        "amun-" + harness,
      );
      expect(await workerIdentities(receipt.identity.panePid, harness)).toEqual(
        identities.get(harness),
      );
    }
    const receipts = join(root, "crew/receipts");
    const original = await loadEndpointReceipt(receipts, "amun-codex");
    await rm(join(receipts, "amun-codex.json"));
    await page.getByLabel("Persistent worker harness").selectOption("codex");
    await page.getByLabel("Worker charter").fill("Do not dispatch again.");
    await page
      .getByRole("button", { name: "Dispatch through Firstmate", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Firstmate recovered the original codex endpoint.",
      }),
    ).toBeVisible();
    expect(await loadEndpointReceipt(receipts, "amun-codex")).toEqual(original);
    await page
      .getByRole("button", { name: "Dispatch through Firstmate", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Firstmate already has this codex worker." }),
    ).toBeVisible();
    expect(await workerIdentities(original.identity.panePid, "codex")).toEqual(
      identities.get("codex"),
    );
    await page
      .getByRole("button", {
        name: "Open verified worker terminal",
        exact: true,
      })
      .click({ timeout: 2500 });
    const terminal = page.getByRole("region", { name: "Terminal dock" });
    await expect(
      terminal.getByRole("button", { name: "Take control", exact: true }),
    ).toBeEnabled();
    await terminal
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    await expect(
      terminal.getByRole("button", {
        name: "Return to read only",
        exact: true,
      }),
    ).toBeVisible();
    await terminal
      .getByRole("button", { name: "Return to read only", exact: true })
      .click();
    await terminal
      .getByRole("button", { name: "Close terminal", exact: true })
      .click();
  } finally {
    await app.close();
    if (socket)
      await promisify(execFile)("/opt/homebrew/bin/tmux", [
        "-S",
        socket,
        "kill-server",
      ]);
    // Retain a failed setup for scoped diagnosis when a launch did not issue its receipt.
    if (socket) {
      for (const path of hooks) {
        const canonical = await realpath(path).catch(() => "");
        if (canonical === path && canonical.startsWith(root + "/workspace/"))
          await chmod(path, 0o700);
      }
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 250,
      });
    }
  }
});
