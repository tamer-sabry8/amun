import { test, expect, _electron as electron } from "@playwright/test";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pilotConnection } from "../../packages/connectors-ado/src/pilot-connection.ts";
import { workspaceIdentity } from "../../packages/data/src/identity.ts";
import { connectionId } from "../../packages/auth/src/broker.ts";
import { azureTransport } from "../../packages/connectors-ado/src/transport.ts";
import { BoardDiscovery } from "../../packages/connectors-ado/src/board-discovery.ts";
import { AdoWriteClient } from "../../packages/connectors-ado/src/governed-writes.ts";
import { AdoReview } from "../../packages/data/src/ado-review.ts";
import { AdoBatch } from "../../packages/data/src/ado-batch.ts";
import {
  acceptanceDb,
  acceptanceDrafts,
} from "../support/ado-acceptance-drafts.ts";

test("ADO bounded publication or separate commitment with an exact reviewed binding", async () => {
  const mode = process.env.AMUN_ADO_STAGE;
  test.skip(!mode, "Opt-in ADO acceptance profile");
  test.setTimeout(180000);
  const root = process.env.AMUN_ADO_ACCEPTANCE_PROFILE ?? "";
  if (
    !/^\/private\/tmp\/amun-m3-ado-accept-[a-zA-Z0-9]+$/.test(root) ||
    ![
      "preview-publish",
      "preview-commit",
      "approve-publish",
      "approve-commit",
      "reconcile-publish",
      "reconcile-commit",
    ].includes(mode!)
  )
    throw Error("Invalid acceptance scope");
  const st = await lstat(root);
  if (!st.isDirectory() || st.uid !== process.getuid!() || st.mode & 0o077)
    throw Error("Unsafe acceptance profile");
  const intent = mode!.endsWith("-publish") ? "publish" : "commit";
  const { collection, project, credential } = pilotConnection();
  const secret = await credential.getPassword();
  if (!secret) throw Error("No ADO credential");
  const transport = azureTransport(collection, secret),
    reader = new BoardDiscovery(collection, project, transport),
    client = new AdoWriteClient(collection, project, transport);
  const team = (await reader.teams()).find(
    (t) => t.name === (process.env.AMUN_ADO_TEAM ?? project + " Team"),
  )!;
  expect(team).toBeTruthy();
  const path = join(root, intent + "-review.json");
  if (mode!.startsWith("preview-")) {
    const ctx = await acceptanceDrafts(root, collection, project);
    const db = acceptanceDb(root);
    try {
      const p = await new AdoReview(db).prepare(
        {
          kind: "ado-operation",
          version: 1,
          requestId: crypto.randomUUID(),
          action: "preview",
          intent,
          productId: ctx.productId,
          sourceId: ctx.sources.find((s) => s.kind === "ado")!.id,
          team: team.id,
          area: project,
          iteration:
            intent === "publish"
              ? project
              : (process.env.AMUN_ADO_ITERATION ?? ""),
          assignee: "",
          items: ctx.storyDrafts.map((d) => ({
            id: d.id,
            title: d.title,
            type: d.type === "story" ? "Product Backlog Item" : "Task",
            fields:
              d.type === "task"
                ? {
                    "Microsoft.VSTS.Common.Activity": "Testing",
                    "Microsoft.VSTS.Scheduling.OriginalEstimate": 0,
                    "Microsoft.VSTS.Scheduling.RemainingWork": 0,
                  }
                : {},
          })),
        },
        { collection, project, team: team.id },
        await reader.processSchema(),
        intent === "commit" ? await reader.iterations(team.id) : [],
        client,
      );
      await writeFile(path, JSON.stringify(p, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
    } finally {
      db.close();
    }
    return;
  }
  const record = JSON.parse(await readFile(path, "utf8")) as {
    id: string;
    binding: string;
  };
  if (process.env.AMUN_APPROVED_BINDING !== record.binding)
    throw Error("The exact review binding must be supplied.");
  const db = acceptanceDb(root);
  const connection = { kind: "ado" as const, baseUrl: collection };
  const account = workspaceIdentity(db) + "/" + connectionId(connection);
  const { AsyncEntry } = createRequire(
    resolve("packages/connectors-ado/package.json"),
  )("@napi-rs/keyring");
  const entry = new AsyncEntry("ai.amun", account);
  const p = new AdoBatch(db).preview(record.id);
  expect(p.kind).toBe(intent);
  expect(p.binding).toBe(record.binding);
  db.prepare(
    "INSERT OR REPLACE INTO workspace_settings(id,value_json) VALUES('connections',?)",
  ).run(JSON.stringify([connection]));
  db.close();
  if (await entry.getPassword())
    throw Error("Temporary credential already exists.");
  await entry.setPassword(secret);
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      args: [
        ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
      ...(process.env.AMUN_PACKAGED_PATH
        ? { executablePath: process.env.AMUN_PACKAGED_PATH }
        : {}),
    });
    const page = await app.firstWindow(),
      button = (name: string) =>
        page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await button("Backlog").click();
    await page.getByLabel("Azure project").selectOption({ label: project });
    await button("Load teams").click();
    await page.getByLabel("Azure team").selectOption(team.id);
    await expect(page.getByLabel("Backlog level")).toBeVisible();
    await button("Load process details").click();
    await button("Load sprint targets and latest review").click();
    const exact = JSON.parse(
      await page.getByLabel("Exact Azure preview").innerText(),
    );
    expect(exact).toEqual({
      intent,
      destination: p.destination,
      steps: p.steps,
    });
    await button(
      mode!.startsWith("reconcile-")
        ? "Reconcile and continue"
        : "Approve and execute reviewed " +
            (intent === "publish" ? "publication" : "commitment"),
    ).click();
    await expect(
      page.getByText("Verified all " + p.steps.length + " Azure items.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 90000 });
    const readback = acceptanceDb(root);
    try {
      for (const e of new AdoBatch(readback).preview(record.id).entries) {
        expect(e.state).toBe("succeeded");
        const item = await client.item(e.remoteId!);
        expect(item.fields["System.AssignedTo"] ?? null).toBeNull();
        expect(item.fields["System.IterationPath"]).toBe(
          p.steps[0]!.fields["System.IterationPath"],
        );
      }
    } finally {
      readback.close();
    }
  } finally {
    try {
      await app?.close();
    } finally {
      await entry.deletePassword();
    }
  }
});
