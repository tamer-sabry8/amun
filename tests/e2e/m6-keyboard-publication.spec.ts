import { test, expect, type Locator } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { access, lstat, readFile, writeFile } from "node:fs/promises";
import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";
import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { reach } from "../support/keyboard.ts";
import { pilotConnection } from "../../packages/connectors-ado/src/pilot-connection.ts";
import { connectionId } from "../../packages/auth/src/broker.ts";
import { workspaceIdentity } from "../../packages/data/src/identity.ts";
import { azureTransport } from "../../packages/connectors-ado/src/transport.ts";
import { AdoWriteClient } from "../../packages/connectors-ado/src/governed-writes.ts";
import { AdoBatch } from "../../packages/data/src/ado-batch.ts";
test("keyboard golden path prepares six live Azure backlog items for exact review", async () => {
  const root = process.env.AMUN_T054_PROFILE;
  test.skip(
    !root,
    "Requires completed Mac authoring profile and designated pilot project",
  );
  if (!root || !/^\/private\/tmp\/amun-m6-keyboard-[A-Za-z0-9]+$/.test(root))
    throw Error("Invalid profile");
  const st = await lstat(root);
  if (!st.isDirectory() || st.uid !== process.getuid!() || st.mode & 0o077)
    throw Error("Unsafe profile");
  await access(join(root, "authoring-passed"));
  test.setTimeout(480000);
  const { credential, collection, project } = pilotConnection();
  if (
    project !== "ICV" ||
    collection !== "https://devops.tahaluf.ae/TahalufCollection/"
  )
    throw Error("Unexpected destination");
  const secret = await credential.getPassword();
  if (!secret) throw Error("Missing saved pilot credential");
  const db = acceptanceDb(root);
  const connection = { kind: "ado", baseUrl: collection } as const;
  const account = workspaceIdentity(db) + "/" + connectionId(connection);
  const { AsyncEntry } = createRequire(
    resolve("packages/connectors-ado/package.json"),
  )("@napi-rs/keyring");
  const entry = new AsyncEntry("ai.amun", account);
  let app: Awaited<ReturnType<typeof launchMacWorkspace>> | undefined;
  let stored = false;
  try {
    if (await entry.getPassword())
      throw Error("Disposable credential already present");
    await entry.setPassword(secret);
    stored = true;
    db.prepare(
      "INSERT OR REPLACE INTO workspace_settings(id,value_json) VALUES('connections',?)",
    ).run(JSON.stringify([connection]));
    app = await launchMacWorkspace(root);
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const activate = async (l: Locator) => {
      await reach(page, l);
      await page.keyboard.press("Enter");
    };
    const btn = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const select = async (l: Locator, name: string) => {
      const id = await l
        .getByRole("option", { name, exact: true, includeHidden: true })
        .getAttribute("value");
      await reach(page, l);
      for (const ch of name)
        await page.keyboard.press(ch === " " ? "Space" : ch);
      await page.keyboard.press("Tab");
      await expect(l).toHaveValue(id ?? name);
    };
    const enter = async (l: Locator, value: string) => {
      await reach(page, l);
      await page.keyboard.press("Meta+a");
      await page.keyboard.insertText(value);
    };
    await activate(btn("Backlog"));
    await select(page.getByLabel("Azure project"), project);
    await activate(btn("Load teams"));
    const status = page
      .getByRole("region", { name: "Azure DevOps backlog" })
      .getByRole("status")
      .last();
    await expect(status).not.toHaveText("Loading…", { timeout: 300000 });
    await expect(status).toHaveText("");
    await select(page.getByLabel("Azure team"), project + " Team");
    await activate(btn("Load process details"));
    const review = page.getByRole("region", { name: "Azure work review" });
    await expect(review).toBeVisible({ timeout: 30000 });
    const prior = db
      .prepare(
        "SELECT id FROM ado_batches WHERE kind='publish' ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { id: string } | undefined;
    if (prior) {
      const saved = JSON.parse(
        await readFile(join(root, "publication-review.json"), "utf8"),
      );
      const current = new AdoBatch(db).preview(prior.id);
      expect(current.id).toBe(saved.id);
      expect(current.binding).toBe(saved.binding);
      const sprint = process.env.AMUN_T054_SPRINT;
      if (sprint) {
        const assignee = process.env.AMUN_T054_ASSIGNEE;
        expect(assignee).toBeTruthy();
        expect(process.env.AMUN_APPROVED_BINDING).toBeUndefined();
        expect(current.entries).toHaveLength(6);
        expect(current.entries.every((e) => e.state === "succeeded")).toBe(
          true,
        );
        const ids = current.entries.map((e) => e.remoteId).sort();
        await activate(btn("Load sprint targets and latest review"));
        const preview = page.getByLabel("Exact Azure preview");
        await expect(preview).toBeVisible();
        if (JSON.parse(await preview.innerText()).intent === "publish") {
          await activate(btn("Close review"));
          const operation = review.getByRole("combobox", {
            name: "Operation",
            exact: true,
          });
          await reach(page, operation);
          await page.keyboard.press("c");
          await expect(operation).toHaveValue("commit");
          const iteration = page.getByLabel("Sprint iteration");
          await select(iteration, sprint);
          await enter(page.getByLabel("Manual assignee (optional)"), assignee!);
          for (const step of current.steps) {
            await reach(
              page,
              review.locator('input[name="select-' + step.itemId + '"]'),
            );
            await page.keyboard.press("Space");
          }
          await activate(btn("Preview commitment"));
        }
        await expect(
          btn("Approve and execute reviewed commitment"),
        ).toBeVisible({ timeout: 30000 });
        const exact = JSON.parse(await preview.innerText());
        const id = db
          .prepare(
            "SELECT id FROM ado_batches WHERE kind='commit' ORDER BY rowid DESC LIMIT 1",
          )
          .pluck()
          .get() as string;
        const held = new AdoBatch(db).preview(id);
        expect(exact).toEqual({
          intent: "commit",
          destination: current.destination,
          steps: held.steps,
        });
        expect(held.steps.map((s) => s.remoteId).sort()).toEqual(ids);
        expect(held.entries.every((e) => e.state === "pending_approval")).toBe(
          true,
        );
        for (const step of held.steps) {
          expect(step.revision).toBe(
            current.entries.find((e) => e.remoteId === step.remoteId)
              ?.remoteRev,
          );
          expect(step.fields).toEqual({
            "System.IterationPath": sprint,
            "System.AssignedTo": assignee,
          });
        }
        await writeFile(
          join(root, "commitment-" + held.binding + ".json"),
          JSON.stringify({ binding: held.binding, ...exact }, null, 2),
          { mode: 0o600 },
        );
        const approved = process.env.AMUN_T054_COMMIT_BINDING;
        if (approved) {
          expect(held.binding).toBe(approved);
          expect(ids).toEqual([
            1089414, 1089415, 1089416, 1089417, 1089418, 1089419,
          ]);
          await activate(btn("Approve and execute reviewed commitment"));
          await expect(
            page.getByText("Verified all 6 Azure items.", { exact: true }),
          ).toBeVisible({ timeout: 120000 });
          const client = new AdoWriteClient(
            collection,
            project,
            azureTransport(collection, secret),
          );
          const receipts = new AdoBatch(db).preview(held.id).entries;
          for (const receipt of receipts) {
            expect(receipt.state).toBe("succeeded");
            const item = await client.item(receipt.remoteId!);
            expect(item.rev).toBe(receipt.remoteRev);
            expect(item.rev).toBeGreaterThan(1);
            expect(item.fields["System.IterationPath"]).toBe(sprint);
            expect(item.fields["System.AssignedTo"]).toMatchObject({
              uniqueName: assignee,
            });
          }
          await writeFile(
            join(root, "commitment-verified.json"),
            JSON.stringify({ binding: held.binding, ids, verified: true }),
            { mode: 0o600, flag: "wx" },
          );
        }
        return;
      }
      expect(current.entries.every((e) => e.state === "pending_approval")).toBe(
        true,
      );
      await activate(btn("Load sprint targets and latest review"));
      const preview = page.getByLabel("Exact Azure preview");
      await expect(preview).toBeVisible();
      expect(JSON.parse(await preview.innerText())).toEqual({
        intent: "publish",
        destination: current.destination,
        steps: current.steps,
      });
      const authorized = process.env.AMUN_APPROVED_BINDING;
      if (authorized) {
        expect(current.binding).toBe(authorized);
        expect(current.steps).toHaveLength(6);
        for (const step of current.steps) {
          expect(step.fields).toMatchObject({
            "System.Title": "Test Story",
            "System.AreaPath": project,
            "System.IterationPath": project,
          });
          expect(step.fields["System.AssignedTo"]).toBeUndefined();
        }
        await activate(btn("Approve and execute reviewed publication"));
        await expect(
          page.getByText("Verified all 6 Azure items.", { exact: true }),
        ).toBeVisible({ timeout: 120000 });
        const receipts = new AdoBatch(db).preview(current.id).entries;
        expect(new Set(receipts.map((e) => e.remoteId)).size).toBe(6);
        const client = new AdoWriteClient(
          collection,
          project,
          azureTransport(collection, secret),
        );
        for (const receipt of receipts) {
          expect(receipt.state).toBe("succeeded");
          const item = await client.item(receipt.remoteId!);
          expect(item.rev).toBe(receipt.remoteRev);
          expect(item.fields["System.Title"]).toBe("Test Story");
          expect(item.fields["System.IterationPath"]).toBe(project);
          expect(item.fields["System.AreaPath"]).toBe(project);
          expect(item.fields["System.AssignedTo"] ?? null).toBeNull();
        }
      }
      return;
    }
    if (process.env.AMUN_APPROVED_BINDING)
      throw Error("Missing reviewed batch");
    const fields = review.locator("fieldset");
    const selected = new Set<string>();
    const choices = db
      .prepare(
        "SELECT id,parent_id,type FROM work_items WHERE id IN (SELECT item_id FROM story_drafts)",
      )
      .all() as { id: string; parent_id: string | null; type: string }[];
    const stories = choices.filter((x) => x.type === "story");
    const eligible = stories.slice(0, 6);
    if (eligible.length < 6)
      eligible.push(
        ...choices
          .filter(
            (x) => x.parent_id && eligible.some((s) => s.id === x.parent_id),
          )
          .slice(0, 6 - eligible.length),
      );
    expect(eligible).toHaveLength(6);
    for (const row of eligible) {
      const group = fields.filter({
        has: page.locator('input[name="select-' + row.id + '"]'),
      });
      await reach(page, group.getByRole("checkbox"));
      await page.keyboard.press("Space");
      selected.add(row.id);
      await enter(
        group.getByLabel("Azure title"),
        row.type === "story" ? "Test Story" : "Test Task",
      );
      await select(
        group.getByLabel("Work item type"),
        row.type === "story" ? "Product Backlog Item" : "Task",
      );
      if (row.type === "task")
        await enter(
          group.getByLabel("Additional Azure fields (JSON)"),
          JSON.stringify({
            "Microsoft.VSTS.Common.Activity": "Testing",
            "Microsoft.VSTS.Scheduling.OriginalEstimate": 0,
            "Microsoft.VSTS.Scheduling.RemainingWork": 0,
          }),
        );
    }
    await activate(btn("Preview publication"));
    const exact = JSON.parse(
      await page
        .getByLabel("Exact Azure preview")
        .innerText({ timeout: 30000 }),
    );
    const id = db
      .prepare(
        "SELECT id FROM ado_batches WHERE kind='publish' ORDER BY rowid DESC LIMIT 1",
      )
      .pluck()
      .get() as string;
    const p = new AdoBatch(db).preview(id);
    expect(exact).toEqual({
      intent: "publish",
      destination: p.destination,
      steps: p.steps,
    });
    expect(new Set(p.steps.map((s) => s.itemId))).toEqual(selected);
    expect(p.entries.every((e) => e.state === "pending_approval")).toBe(true);
    await writeFile(
      join(root, "publication-review.json"),
      JSON.stringify(p, null, 2),
      { mode: 0o600, flag: "wx" },
    );
  } finally {
    try {
      await app?.close();
    } finally {
      db.close();
      if (stored) await entry.deletePassword();
    }
  }
});
