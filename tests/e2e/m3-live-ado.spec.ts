import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pilotConnection } from "../../packages/connectors-ado/src/pilot-connection.ts";
import { azureTransport } from "../../packages/connectors-ado/src/transport.ts";
import { AdoProofClient } from "../../packages/connectors-ado/src/client.ts";
import { BoardDiscovery } from "../../packages/connectors-ado/src/board-discovery.ts";
import { connectionId } from "../../packages/auth/src/broker.ts";

test("reads an ADO team backlog in the Mac list and board and compares a card to Azure", async () => {
  test.skip(
    process.env.AMUN_LIVE_ADO_READ !== "1",
    "Requires the approved ADO connection and company network.",
  );
  test.setTimeout(300000);
  const { collection, project: pilotProject, credential } = pilotConnection();
  const secret = await credential.getPassword();
  if (!secret) throw Error("The existing ADO Keychain credential is missing.");
  const transport = azureTransport(collection, secret);
  const discovery = new BoardDiscovery(collection, pilotProject, transport);
  const schema = await discovery.processSchema();
  expect(schema.types.some((type) => type.name === "Task")).toBe(true);
  const teams = await discovery.teams();
  async function sample() {
    for (const team of teams) {
      const boards = await discovery.boards(team.id);
      const levels = await discovery.levels(team.id);
      for (const level of levels) {
        if (!boards.some((b) => b.name === level.name)) continue;
        const settings = await discovery.boardSettings(team.id, level.name);
        const cards = await discovery.cards(
          team.id,
          level.id,
          settings.columnField,
        );
        const card = cards.find((c) => c.column);
        if (card)
          return {
            team: team.id,
            level: level.id,
            count: cards.length,
            card,
            column: settings.columnField,
          };
      }
    }
    throw Error("No accessible ADO board contains a mapped card.");
  }
  const selected = await sample();
  const item = (await new AdoProofClient(
    collection,
    pilotProject,
    transport,
  ).item(selected.card.id)) as { rev: number; fields: Record<string, unknown> };
  expect(
    item.rev === selected.card.rev &&
      item.fields["System.Title"] === selected.card.title &&
      item.fields[selected.column] === selected.card.column,
  ).toBe(true);
  const root = realpathSync(await mkdtemp(join(tmpdir(), "amun-m3-live-ado-")));
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  let erase: (() => Promise<unknown>) | undefined;
  try {
    const page = await app.firstWindow();
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const Database = createRequire(resolve("packages/data/package.json"))(
      "better-sqlite3",
    );
    const db = new Database(join(root, "workspace/workspace.sqlite"));
    try {
      const identity = JSON.parse(
        db
          .prepare(
            "SELECT value_json FROM workspace_settings WHERE id='workspace_identity'",
          )
          .get().value_json,
      );
      const connection = { kind: "ado" as const, baseUrl: collection };
      const account = identity + "/" + connectionId(connection);
      const { AsyncEntry } = createRequire(
        resolve("packages/connectors-ado/package.json"),
      )("@napi-rs/keyring");
      const entry = new AsyncEntry("ai.amun", account);
      if (await entry.getPassword())
        throw Error("Unexpected existing temporary credential.");
      await entry.setPassword(secret);
      erase = () => entry.deletePassword();
      db.prepare(
        "INSERT INTO workspace_settings(id,value_json) VALUES('connections',?)",
      ).run(JSON.stringify([connection]));
    } finally {
      db.close();
    }
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").pressSequentially("ADO acceptance");
    await button("Create product").click();
    await page.getByLabel("Source type").selectOption("ado");
    await page.getByLabel("Source title").fill(pilotProject);
    await page.getByLabel("Source reference").fill(collection + pilotProject);
    await button("Map source").click();
    await expect(
      page.getByRole("region", { name: "Product context" }),
    ).toContainText(collection + pilotProject);
    await button("Backlog").click();
    await page
      .getByLabel("Azure project")
      .selectOption({ label: pilotProject });
    await button("Load teams").click();
    await page.getByLabel("Azure team").selectOption(selected.team);
    await page.getByLabel("Backlog level").selectOption(selected.level);
    await button("Load work items").click();
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(selected.count, { timeout: 60000 });
    const row = rows.filter({
      has: page.getByRole("cell", {
        name: String(selected.card.id),
        exact: true,
      }),
    });
    const fields = await row.getByRole("cell").allTextContents();
    expect(
      fields[1] === selected.card.title &&
        fields[4] === selected.card.column &&
        fields[5] === String(selected.card.rev),
    ).toBe(true);
    await button("Board view").click();
    const columns = page.locator(".backlog-columns > section");
    expect(
      await columns.evaluateAll(
        (els, { name, id }) =>
          els.some(
            (el) =>
              el.querySelector("h3")?.textContent === name &&
              Array.from(el.querySelectorAll("li")).some((li) =>
                li.textContent?.startsWith("#" + id + " "),
              ),
          ),
        { name: selected.card.column, id: selected.card.id },
      ),
    ).toBe(true);
  } finally {
    try {
      await app.close();
    } finally {
      try {
        await erase?.();
      } finally {
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
