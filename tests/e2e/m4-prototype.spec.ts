import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, realpath, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  acceptanceDb,
  acceptanceDrafts,
} from "../support/ado-acceptance-drafts.ts";
import { WorkspaceService } from "../../packages/data/src/workspace-service.ts";
import { loadEndpointReceipt } from "../../packages/crew/src/endpoint-receipt.ts";
import { observeOwnedTmux } from "../../packages/crew/src/observe-owned-tmux.ts";
import { verifyDisposableWorker } from "./crew-acceptance-worker.ts";
test("Designer prototype pinned feedback becomes an approved PRD change", async () => {
  test.skip(
    process.env.AMUN_LIVE_CREW_DISPATCH !== "1",
    "Requires Amun's configured Designer worker.",
  );
  test.setTimeout(320000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-dispatch-e2e-")),
  );
  const c = await acceptanceDrafts(root, "https://example.test/", "Library");
  const db = acceptanceDb(root),
    ws = new WorkspaceService(db);
  const objective = c.objectives[0]!;
  for (const [action, fields] of [
    [
      "save-understanding",
      {
        facts: "Review results by item",
        assumptions: "",
        questions: "",
        expectedVersion: 0,
      },
    ],
    ["approve-understanding", { expectedVersion: 1 }],
  ] as const) {
    const r = ws.handle({
      version: 1,
      kind: "workspace",
      action,
      productId: c.productId,
      objectiveId: objective.id,
      ...fields,
    });
    expect(r?.kind).toBe("workspace-snapshot");
  }
  db.close();
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
  });
  let receipt: Awaited<ReturnType<typeof loadEndpointReceipt>> | undefined;
  try {
    const p = await app.firstWindow(),
      button = (name: string) => p.getByRole("button", { name, exact: true });
    await expect(p.locator("#service-status")).toHaveText("Connected");
    await button("Agents").click();
    await p.getByLabel("Persistent worker harness").selectOption("claude");
    await p
      .getByLabel("Worker charter")
      .fill(
        "Designer. Handle bounded Amun prototype briefs and return only the requested output.",
      );
    await button("Dispatch through Firstmate").click();
    await expect(
      p.getByRole("status").filter({ hasText: "Firstmate dispatched claude" }),
    ).toBeVisible({ timeout: 80000 });
    receipt = await loadEndpointReceipt(
      join(root, "crew/receipts"),
      "amun-claude",
    );
    expect(receipt.home.startsWith(root + "/workspace/firstmate-home-")).toBe(
      true,
    );
    await verifyDisposableWorker(root, "claude");
    await button("PRD").click();
    await button("Explore a prototype").click();
    await expect(
      p.getByText("Firstmate sent the approved PRD brief to the Designer."),
    ).toBeVisible({ timeout: 90000 });
    const runDb = acceptanceDb(root);
    const { run_id: runId } = runDb
      .prepare("SELECT run_id FROM prototype_runs WHERE objective=?")
      .get(objective.id) as { run_id: string };
    runDb.close();
    const outputDir = join(root, "workspace", "prototypes", runId);
    await expect(async () => {
      const { socket, identity } = receipt!;
      const tm = (...args: string[]) =>
        execFileSync("/opt/homebrew/bin/tmux", ["-N", "-S", socket, ...args], {
          encoding: "utf8",
        });
      const screen = tm("capture-pane", "-p", "-t", identity.paneId),
        compact = screen.replace(/\s/g, "");
      const scopedRead = ["brief.json", "design.json"].some((file) =>
        compact.includes("Read(" + join(outputDir, file) + ")"),
      );
      const scopedWrite =
        compact.includes(join(outputDir, "design.json")) &&
        /Do you want to (?:create|edit|write)/i.test(screen) &&
        /^\s*[❯›]?\s*1[.] Yes\s*$/m.test(screen);
      if (
        (scopedRead &&
          screen.includes("Allow this read outside the working directories?") &&
          screen.includes("4. Yes, but ask again next time")) ||
        scopedWrite
      ) {
        expect(
          (
            await observeOwnedTmux(
              join(root, "crew/receipts"),
              "amun-claude",
              "/opt/homebrew/bin/tmux",
            )
          ).endpoint,
        ).toBe("verified");
        tm("send-keys", "-t", identity.paneId, scopedWrite ? "1" : "4");
      }
      await button("Open Designer preview").click();
      await expect(p.getByLabel("Preview URL")).toHaveValue(
        /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/,
        { timeout: 2000 },
      );
    }).toPass({ timeout: 140000, intervals: [2500] });
    const url = await p.getByLabel("Preview URL").inputValue();
    await expect(async () => {
      const seen = await app.evaluate(async ({ webContents }, url) => {
        const guest = webContents
          .getAllWebContents()
          .find((c) => c.getURL() === url);
        if (!guest) return false;
        return guest.executeJavaScript(
          "document.querySelector('details').open=true;document.querySelector('[name=feedback]').value='Show the result timestamp';document.querySelector('form').requestSubmit();true",
        );
      }, url);
      expect(seen).toBe(true);
    }).toPass({ timeout: 10000 });
    await expect
      .poll(
        () =>
          app.evaluate(async ({ webContents }, url) => {
            const guest = webContents
              .getAllWebContents()
              .find((c) => c.getURL() === url);
            return guest?.executeJavaScript(
              "document.body.innerText.includes('Feedback: Show the result timestamp')",
            );
          }, url),
        { timeout: 10000 },
      )
      .toBe(true);
    await button("Review pinned feedback").click();
    await expect(
      p.getByText("Firstmate proposal", { exact: true }),
    ).toBeVisible();
    await button("Apply proposal").click();
    await expect(p.getByLabel("PRD approval status")).toContainText(
      "Draft PRD v2",
    );
    await button("Approve PRD v2").click();
    await expect(p.getByLabel("PRD approval status")).toContainText(
      "Approved PRD v2",
    );
    const journal = acceptanceDb(root);
    try {
      const updated = new WorkspaceService(journal).snapshot().productContext!
        .objectives[0]!.prd!;
      expect(updated.markdown).toContain("Show the result timestamp");
      expect(updated.version).toBe(2);
      expect(updated.approved).toBe(true);
    } finally {
      journal.close();
    }
  } catch (error) {
    if (receipt) {
      const pane = execFileSync(
        "/opt/homebrew/bin/tmux",
        [
          "-N",
          "-S",
          receipt.socket,
          "capture-pane",
          "-p",
          "-t",
          receipt.identity.paneId,
        ],
        { encoding: "utf8" },
      );
      const report = {
        requiresPermission:
          /do you want to|allow.*write|permission required|do you trust/i.test(
            pane,
          ),
        mentionsDesign: pane.includes("design.json"),
        mentionsInbox: /inbox/i.test(pane),
        completed: /prototype.*ready|wrote.*design/i.test(pane),
      };
      await test.info().attach("disposable-designer-status", {
        body: JSON.stringify(report),
        contentType: "application/json",
      });
    }
    throw error;
  } finally {
    await app.close();
    if (
      receipt &&
      receipt.home.startsWith(root + "/workspace/") &&
      /^\/private\/tmp\/amun-tmux-[A-Za-z0-9]{6}$/.test(receipt.scope)
    ) {
      const owner = execFileSync(
        "/opt/homebrew/bin/tmux",
        ["-S", receipt.socket, "show-options", "-gqv", "@amun-owner"],
        { encoding: "utf8" },
      ).trim();
      if (owner === receipt.identity.ownerToken) {
        execFileSync("/opt/homebrew/bin/tmux", [
          "-S",
          receipt.socket,
          "kill-server",
        ]);
        await chmod(
          join(receipt.home, "state/amun-claude.git-hooks"),
          0o700,
        ).catch(() => {});
        await rm(root, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
      }
    }
  }
});
