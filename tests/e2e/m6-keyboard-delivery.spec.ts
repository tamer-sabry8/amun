import { test, expect, type Locator } from "@playwright/test";
import { access, lstat, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { reach } from "../support/keyboard.ts";
import {
  materializeDeliveryTree,
  deliveryHead,
} from "../../packages/crew/src/delivery-worktree.ts";
import { loadEndpointReceipt } from "../../packages/crew/src/endpoint-receipt.ts";
import { observeOwnedTmux } from "../../packages/crew/src/observe-owned-tmux.ts";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";

test("keyboard journey resumes the saved story and reaches implementation repository selection", async () => {
  const root = process.env.AMUN_T054_PROFILE;
  test.skip(!root, "Requires the preserved keyboard acceptance profile.");
  if (!root || !/^\/private\/tmp\/amun-m6-keyboard-[A-Za-z0-9]+$/.test(root))
    throw Error("Invalid acceptance profile");
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid!() ||
    stat.mode & 0o077
  )
    throw Error("Unsafe acceptance profile");
  await access(join(root, "commitment-verified.json"));
  await access(join(root, "deletion-verified.json"));
  test.setTimeout(300000);
  const checkout = process.env.AMUN_T054_CHECKOUT;
  const db = acceptanceDb(root);
  try {
    expect(
      db
        .prepare(
          "SELECT count(*) FROM work_items WHERE type='story' AND status='committed'",
        )
        .pluck()
        .get(),
    ).toBe(6);
  } finally {
    db.close();
  }
  let app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const activate = async (control: Locator) => {
      await reach(page, control);
      await page.keyboard.press("Enter");
    };
    const enter = async (control: Locator, value: string) => {
      await reach(page, control);
      await page.keyboard.press("Meta+a");
      await page.keyboard.insertText(value);
    };
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    if (checkout) {
      expect(checkout).toBe("/Users/tamersabry/Projects/amun");
      await activate(button("Overview"));
      const context = page.getByRole("region", { name: "Product context" });
      if (
        !(await context
          .getByText("TEST implementation repository", { exact: false })
          .count())
      ) {
        await reach(page, context.getByLabel("Source type"));
        await page.keyboard.press("r");
        await page.keyboard.press("Tab");
        await enter(
          context.getByLabel("Source title"),
          "TEST implementation repository",
        );
        await enter(
          context.getByLabel("Source reference"),
          "https://github.com/tamer-sabry8/amun.git",
        );
        await activate(
          context.getByRole("button", { name: "Map source", exact: true }),
        );
      }
      await expect(context).toContainText(
        "https://github.com/tamer-sabry8/amun.git",
      );
    }
    const backlog = page.getByRole("button", { name: "Backlog", exact: true });
    await reach(page, backlog);
    await page.keyboard.press("Enter");
    const story = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Revoke Invitation",
        exact: true,
      }),
    });
    await expect(story).toBeVisible();
    const implement = story.getByRole("button", {
      name: "Ask Firstmate to implement",
      exact: true,
    });
    await reach(page, implement);
    await page.keyboard.press("Enter");
    const scope = story.getByRole("region", { name: "Implementation scope" });
    const approved = process.env.AMUN_T054_START_BINDING;
    if (approved) {
      const saved = JSON.parse(
        await readFile(join(root, "implementation-review.json"), "utf8"),
      );
      expect(saved.binding).toBe(approved);
      const state = acceptanceDb(root);
      try {
        const action = state
          .prepare("SELECT state,payload_hash FROM actions WHERE id=?")
          .get(saved.scope.id) as { state: string; payload_hash: string };
        expect(action.payload_hash).toBe(approved);
        expect(["pending_approval", "succeeded"]).toContain(action.state);
        await expect(scope).toContainText(saved.scope.branch);
        await expect(scope).toContainText(saved.scope.head);
        if (action.state === "pending_approval") {
          await activate(
            scope.getByRole("button", {
              name: "Approve scope and start run",
              exact: true,
            }),
          );
          await expect(scope.getByRole("status")).toHaveText(
            "Firstmate delivered the brief to the Engineer.",
            { timeout: 180000 },
          );
        }
        const row = state
          .prepare(
            "SELECT firstmate_task_id,pane_ref,worktree,branch,state FROM runs WHERE id=?",
          )
          .get(saved.scope.id);
        expect(row).toMatchObject({
          worktree: saved.scope.worktree,
          branch: saved.scope.branch,
          state: "running",
        });
        const receipt = await loadEndpointReceipt(
          join(root, "crew", "receipts"),
          "amun-codex",
        );
        expect(
          await observeOwnedTmux(
            join(root, "crew", "receipts"),
            "amun-codex",
            "/opt/homebrew/bin/tmux",
          ),
        ).toMatchObject({ endpoint: "verified" });
        const identity = async () =>
          (
            await promisify(execFile)("/bin/ps", [
              "-p",
              String(receipt.identity.panePid),
              "-o",
              "pid=,lstart=,comm=",
            ])
          ).stdout.trim();
        const codexIdentity = async () => {
          const rows = (
            await promisify(execFile)("/bin/ps", [
              "-axo",
              "pid=,ppid=,lstart=,comm=",
            ])
          ).stdout
            .split("\n")
            .map((line) =>
              line
                .trim()
                .match(
                  /^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+)$/,
                ),
            )
            .filter((row) => row !== null);
          const descendants = new Set([receipt.identity.panePid]);
          for (let i = 0; i < 20; i++)
            for (const row of rows)
              if (descendants.has(Number(row[2])))
                descendants.add(Number(row[1]));
          return rows
            .filter(
              (row) =>
                descendants.has(Number(row[1])) && row[4]!.endsWith("/codex"),
            )
            .map((row) => row[1] + " " + row[3])
            .sort();
        };
        const before = await identity();
        const workerBefore = await codexIdentity();
        expect(before).toBeTruthy();
        expect(workerBefore.length).toBeGreaterThan(0);
        await app.close();
        app = await launchMacWorkspace(root);
        const resumed = await app.firstWindow();
        await expect(resumed.locator("#service-status")).toHaveText(
          "Connected",
        );
        const back = resumed.getByRole("button", {
          name: "Backlog",
          exact: true,
        });
        await reach(resumed, back);
        await resumed.keyboard.press("Enter");
        const again = resumed.getByRole("article").filter({
          has: resumed.getByRole("heading", {
            name: "Revoke Invitation",
            exact: true,
          }),
        });
        const open = again.getByRole("button", {
          name: "Ask Firstmate to implement",
          exact: true,
        });
        await reach(resumed, open);
        await resumed.keyboard.press("Enter");
        await expect(again).toContainText(saved.scope.worktree);
        await expect(
          again.getByRole("button", {
            name: "Check worker report and resume",
            exact: true,
          }),
        ).toBeVisible();
        expect(
          await loadEndpointReceipt(
            join(root, "crew", "receipts"),
            "amun-codex",
          ),
        ).toEqual(receipt);
        expect(await identity()).toBe(before);
        expect(await codexIdentity()).toEqual(workerBefore);
        expect(
          await observeOwnedTmux(
            join(root, "crew", "receipts"),
            "amun-codex",
            "/opt/homebrew/bin/tmux",
          ),
        ).toMatchObject({ endpoint: "verified" });
        expect(
          state
            .prepare(
              "SELECT firstmate_task_id,pane_ref,worktree,branch,state FROM runs WHERE id=?",
            )
            .get(saved.scope.id),
        ).toEqual(row);
        if (process.env.AMUN_T054_WORKER_TERMINAL) {
          const go = async (control: Locator) => {
            await reach(resumed, control);
            await resumed.keyboard.press("Enter");
          };
          await go(
            resumed.getByRole("button", { name: "Agents", exact: true }),
          );
          const task = resumed.getByLabel("Firstmate task ID");
          await reach(resumed, task);
          await resumed.keyboard.press("Meta+a");
          await resumed.keyboard.insertText("amun-codex");
          await go(
            resumed.getByRole("button", {
              name: "Observe worker",
              exact: true,
            }),
          );
          await expect(resumed.getByTestId("agent-endpoint")).toHaveText(
            "amun-codex · Endpoint verified",
            { timeout: 30000 },
          );
          await go(
            resumed.getByRole("button", {
              name: "Open verified worker terminal",
              exact: true,
            }),
          );
          const dock = resumed.getByRole("region", { name: "Terminal dock" });
          await go(
            dock.getByRole("button", { name: "Take control", exact: true }),
          );
          await expect(
            dock.getByRole("button", {
              name: "Return to read only",
              exact: true,
            }),
          ).toBeVisible();
          const terminal = resumed.locator(".xterm-helper-textarea");
          await reach(resumed, terminal);
          const message = process.env.AMUN_T054_WORKER_MESSAGE;
          if (message) {
            await resumed.keyboard.insertText(message);
          }
          if (message || process.env.AMUN_T054_SUBMIT_PENDING) {
            // Codex treats an Enter arriving with bracketed paste as part of the paste.
            await resumed.waitForTimeout(500);
            await resumed.keyboard.press("Enter");
            await resumed.waitForTimeout(500);
          }
          await resumed.keyboard.press("Shift+Tab");
          await go(
            dock.getByRole("button", {
              name: "Return to read only",
              exact: true,
            }),
          );
        }
        if (process.env.AMUN_T054_REFRESH) {
          const refresh = again.getByRole("button", {
            name: "Check worker report and resume",
            exact: true,
          });
          await reach(resumed, refresh);
          await resumed.keyboard.press("Enter");
          await expect(again.getByRole("status")).toHaveText(
            "The Engineer needs a decision. Open Requests to answer.",
            { timeout: 30000 },
          );
          expect(
            state
              .prepare("SELECT state FROM runs WHERE id=?")
              .pluck()
              .get(saved.scope.id),
          ).toBe("blocked");
        }
        await writeFile(
          join(root, "delivery-reattached.json"),
          JSON.stringify({
            scope: saved.scope.id,
            binding: approved,
            verified: true,
          }),
          { mode: 0o600 },
        );
      } finally {
        state.close();
      }
      return;
    }
    await expect(scope.getByRole("status")).toHaveText(
      "Select a repository and its local checkout.",
    );
    const repo = scope.getByLabel("Implementation repository");
    await reach(page, repo);
    if (checkout) {
      await page.keyboard.press("t");
      await page.keyboard.press("Tab");
      await reach(page, scope.getByLabel("Branch purpose"));
      await page.keyboard.press("t");
      await page.keyboard.press("Tab");
      await enter(scope.getByLabel("Local repository checkout"), checkout);
      await activate(
        scope.getByRole("button", {
          name: "Preview implementation scope",
          exact: true,
        }),
      );
      await expect(scope.getByRole("status")).toHaveText(
        "Review the commit, branch and worktree before starting.",
        { timeout: 30000 },
      );
      const state = acceptanceDb(root);
      try {
        const row = state
          .prepare(
            "SELECT payload_json,payload_hash,state FROM actions WHERE kind='implementation_scope' ORDER BY rowid DESC LIMIT 1",
          )
          .get() as {
          payload_json: string;
          payload_hash: string;
          state: string;
        };
        expect(row.state).toBe("pending_approval");
        const payload = JSON.parse(row.payload_json);
        expect(payload.story).toBe("42343384-de5d-48de-8d03-355cb5fa76ea");
        expect(payload.scope.source).toBe(checkout);
        expect(payload.scope.remote).toBe(
          "https://github.com/tamer-sabry8/amun.git",
        );
        expect(payload.scope.branch).toMatch(/^test\/story-/);
        await expect(scope).toContainText(payload.scope.head);
        await expect(scope).toContainText(payload.scope.branch);
        await expect(scope).toContainText(payload.scope.worktree);
        await materializeDeliveryTree(
          join(root, "workspace", "delivery"),
          payload.scope,
        );
        expect(
          await deliveryHead(
            join(root, "workspace", "delivery"),
            payload.scope,
          ),
        ).toBe(payload.scope.head);
        await writeFile(
          join(root, "implementation-review.json"),
          JSON.stringify({ ...payload, binding: row.payload_hash }, null, 2),
          { mode: 0o600 },
        );
      } finally {
        state.close();
      }
      return;
    }
    await expect(repo.locator("option")).toHaveText(["Select repository"]);
    await expect(
      scope.getByRole("button", {
        name: "Preview implementation scope",
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    await app.close();
  }
});
