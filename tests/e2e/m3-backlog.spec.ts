import { acceptanceDrafts } from "../support/ado-acceptance-drafts.ts";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Backlog opens the selected product's mapped Azure project and explains a missing connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m3-board-"));
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").pressSequentially("Library");
    await button("Create product").click();
    await page.getByLabel("Source type").selectOption("ado");
    await page.getByLabel("Source title").fill("Library board");
    await page
      .getByLabel("Source reference")
      .fill("https://example.test/Collection/Library");
    await button("Map source").click();
    await expect(
      page.getByRole("region", { name: "Product context" }),
    ).toContainText("Library board");
    await button("Backlog").click();
    await page
      .getByLabel("Azure project")
      .selectOption({ label: "Library board" });
    await button("Load teams").click();
    await expect(
      page.getByRole("region", { name: "Azure DevOps backlog" }),
    ).toContainText("Connect the mapped Azure collection in Settings.");
  } finally {
    await app.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});

test("renders server revisions and mapped board columns through the Mac service and a local TLS Azure fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m3-read-model-"));
  const key = join(root, "tls.key"),
    cert = join(root, "tls.pem"),
    conf = join(root, "tls.cnf");
  await writeFile(
    conf,
    "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n",
  );
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-config",
      conf,
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  type Remote = {
    id: number;
    rev: number;
    fields: Record<string, unknown>;
    relations: { rel: string; url: string }[];
  };
  const remotes = new Map<number, Remote>([
    [
      42,
      {
        id: 42,
        rev: 7,
        fields: {
          "System.Title": "Renew a loan",
          "System.WorkItemType": "Issue",
          "System.State": "Active",
          "WEF.column": "Peer review",
        },
        relations: [],
      },
    ],
  ]);
  let creates = 0;
  const server = createServer(
    { key: await readFile(key), cert: await readFile(cert) },
    async (req, res) => {
      const path = new URL(req.url!, "https://127.0.0.1").pathname;
      const rows: Record<string, unknown> = {
        "/Collection/_apis/projects/Library": {
          capabilities: {
            processTemplate: { templateName: "Fixture process" },
          },
        },
        "/Collection/Library/_apis/wit/workitemtypes": {
          value: [{ name: "Issue" }],
        },
        "/Collection/Library/_apis/wit/workitemtypes/Issue/fields": {
          value: [
            {
              name: "Owner",
              referenceName: "Example.Owner",
              alwaysRequired: true,
            },
          ],
        },
        "/Collection/Library/_apis/wit/workitemtypes/Issue/states": {
          value: [{ name: "Active" }],
        },
        "/Collection/Library/_apis/wit/classificationnodes/areas": {
          name: "Library",
        },
        "/Collection/Library/_apis/wit/classificationnodes/iterations": {
          name: "Library",
          children: [{ name: "Week 1" }],
        },
        "/Collection/_apis/projects/Library/teams": {
          value: [{ id: "t", name: "West" }],
        },
        "/Collection/Library/t/_apis/work/boards": {
          value: [{ id: "b", name: "Delivery" }],
        },
        "/Collection/Library/t/_apis/work/backlogs": {
          value: [{ id: "level", name: "Stories" }],
        },
        "/Collection/Library/t/_apis/work/boards/Stories": {
          canEdit: false,
          fields: { columnField: { referenceName: "WEF.column" } },
        },
        "/Collection/Library/t/_apis/work/boards/Stories/columns": {
          value: [
            {
              id: "c",
              name: "Peer review",
              stateMappings: { Issue: "Active" },
            },
            { id: "d", name: "Done", stateMappings: { Issue: "Closed" } },
          ],
        },
        "/Collection/Library/t/_apis/work/backlogs/level/workItems": {
          workItems: [{ target: { id: 42 } }],
        },
        "/Collection/Library/_apis/wit/workitems": {
          value: [
            {
              id: 42,
              rev: 7,
              fields: {
                "System.Title": "Renew a loan",
                "System.WorkItemType": "Issue",
                "System.State": "Active",
                "WEF.column": "Peer review",
              },
            },
          ],
        },
      };
      rows["/Collection/Library/t/_apis/work/teamsettings/iterations"] = {
        value: [{ path: "Library\\Week 1" }],
      };
      rows["/Collection/Library/_apis/wit/workitems"] = {
        value: [remotes.get(42)],
      };
      const respond = (code: number, value: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (!req.headers.authorization) {
        respond(403, {});
        return;
      }
      const endpoint = "/Collection/Library/_apis/wit/";
      const id = Number(path.split("/").at(-1));
      if (
        req.method === "GET" &&
        path.startsWith(endpoint + "workitems/") &&
        remotes.has(id)
      ) {
        respond(200, remotes.get(id));
        return;
      }
      if (req.method === "POST" || req.method === "PATCH") {
        const chunks: Buffer[] = [];
        for await (const part of req) chunks.push(Buffer.from(part));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (path === endpoint + "wiql") {
          respond(200, {
            workItems: [...remotes.values()]
              .filter((x) =>
                body.query.includes("'" + x.fields["System.Tags"] + "'"),
              )
              .map((x) => ({ id: x.id })),
          });
          return;
        }
        if (!path.startsWith(endpoint + "workitems/")) {
          respond(404, {});
          return;
        }
        const creating = req.method === "POST";
        const nextId = creating ? 100 + ++creates : id;
        const item: Remote = creating
          ? {
              id: nextId,
              rev: 0,
              fields: { "System.WorkItemType": "Issue" },
              relations: [],
            }
          : remotes.get(id)!;
        if (!creating && body[0]?.value !== item.rev) {
          respond(412, {});
          return;
        }
        for (const patch of body) {
          if (patch.path.startsWith("/fields/"))
            item.fields[patch.path.slice(8)] = patch.value;
          if (patch.path === "/relations/-") item.relations.push(patch.value);
        }
        item.rev++;
        remotes.set(nextId, item);
        if (creating && creates === 3) {
          req.socket.destroy();
          return;
        }
        respond(200, item);
        return;
      }
      const ok =
        req.method === "GET" &&
        !!req.headers.authorization &&
        Object.hasOwn(rows, path);
      res.writeHead(ok ? 200 : 403, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ok ? rows[path] : {}));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const collection =
    "https://127.0.0.1:" +
    (server.address() as AddressInfo).port +
    "/Collection";
  const launch = () =>
    electron.launch({
      args: [
        ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
      ...(process.env.AMUN_PACKAGED_PATH
        ? { executablePath: process.env.AMUN_PACKAGED_PATH }
        : {}),
      env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
    });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  test.setTimeout(90000);
  let saved = false;
  try {
    app = await launch();
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await button("Settings").click();
    await page.getByLabel("Service", { exact: true }).selectOption("ado");
    await page.getByLabel("Collection or organisation URL").fill(collection);
    await page
      .getByLabel("Personal access token")
      .fill("DisposableFixtureCredential");
    await button("Save connection").click();
    await expect(button("Disconnect")).toBeVisible();
    saved = true;
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").pressSequentially("Library");
    await button("Create product").click();
    await page.getByLabel("Source type").selectOption("ado");
    await page.getByLabel("Source title").fill("Library board");
    await page.getByLabel("Source reference").fill(collection + "/Library");
    await button("Map source").click();
    await expect(
      page.getByRole("region", { name: "Product context" }),
    ).toContainText("Library board");
    await acceptanceDrafts(root, collection + "/", "Library", [
      "Test task A",
      "Test task B",
      "Test task C",
    ]);
    await button("Backlog").click();
    await page
      .getByLabel("Azure project")
      .selectOption({ label: "Library board" });
    await button("Load teams").click();
    await expect(page.getByLabel("Azure team")).toBeVisible();
    await button("Load process details").click();
    await expect(
      page.getByText("Fixture process", { exact: true }),
    ).toBeVisible();
    await page.getByText("Issue", { exact: true }).click();
    await expect(page.getByText("Owner · required")).toBeVisible();
    await page.getByLabel("Azure team").selectOption("t");
    await page.getByLabel("Backlog level").selectOption("level");
    await button("Load work items").click();
    const row = page.getByRole("row").filter({ hasText: "Renew a loan" });
    await expect(row).toBeVisible();
    expect(
      await row
        .getByRole("cell")
        .allTextContents()
        .then((c) => c.join("|")),
    ).toBe("42|Renew a loan|Issue|Active|Peer review|7");
    await button("Board view").click();
    await expect(
      page.getByRole("heading", { name: "Peer review" }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Renew a loan" }),
    ).toContainText("#42");
    await page.getByText("Edit #42", { exact: true }).click();
    await page.getByLabel("Item title").fill("Reviewed title");
    await page.getByLabel("Board column").selectOption("Done");
    await button("Review edit").click();
    remotes.get(42)!.rev = 8;
    await button("Save reviewed edit").click();
    await expect(page.getByText(/Your edits are retained/)).toBeVisible();
    await expect(page.getByLabel("Item title")).toHaveValue("Reviewed title");
    await button("List view").click();
    await button("Load work items").click();
    await expect(
      row.getByRole("cell", { name: "8", exact: true }),
    ).toBeVisible();
    await page.getByText("Edit #42", { exact: true }).click();
    await page.getByLabel("Item title").fill("Reviewed title");
    await page.getByLabel("Board column").selectOption("Done");
    await button("Review edit").click();
    await button("Save reviewed edit").click();
    await expect(
      page.getByText("Saved and verified #42 at revision 9."),
    ).toBeVisible();
    expect(remotes.get(42)!.fields).toMatchObject({
      "System.State": "Closed",
      "WEF.column": "Done",
    });
    const review = page.getByRole("region", { name: "Azure work review" });
    await review.getByRole("checkbox").first().waitFor();
    for (const box of await review.getByRole("checkbox").all())
      await box.check();
    await button("Preview publication").click();
    await expect(review).toContainText("Required fields: Example.Owner");
    for (const field of await review
      .getByLabel("Additional Azure fields (JSON)")
      .all())
      await field.fill('{"Example.Owner":"Fixture"}');
    await button("Preview publication").click();
    await expect(page.getByLabel("Exact Azure preview")).toContainText(
      "Library",
    );
    expect(creates).toBe(0);
    await button("Approve and execute reviewed publication").click();
    await expect(review).toContainText("Execution paused");
    expect(creates).toBe(3);
    await button("Reconcile and continue").click();
    await expect(review).toContainText("Verified all 4 Azure items.");
    expect(creates).toBe(4);
    const published = [...remotes.values()].filter((x) => x.id !== 42);
    expect(
      published.every(
        (x) =>
          x.fields["System.IterationPath"] === "Library" &&
          !x.fields["System.AssignedTo"],
      ),
    ).toBe(true);
    await button("Close review").click();
    await button("Load sprint targets and latest review").click();
    await button("Close review").click();
    await page
      .getByRole("combobox", { name: /^Operation/ })
      .selectOption("commit");
    await page.getByLabel("Sprint iteration").selectOption("Library\\Week 1");
    for (const box of await review.getByRole("checkbox").all())
      await box.check();
    await button("Preview commitment").click();
    await expect(page.getByLabel("Exact Azure preview")).toContainText(
      "Week 1",
    );
    expect(
      published.every((x) => x.fields["System.IterationPath"] === "Library"),
    ).toBe(true);
    await button("Approve and execute reviewed commitment").click();
    await expect(review).toContainText("Verified all 4 Azure items.");
    expect(
      published.every(
        (x) =>
          x.fields["System.IterationPath"] === "Library\\Week 1" &&
          !x.fields["System.AssignedTo"],
      ),
    ).toBe(true);
  } catch (error) {
    if (app)
      await test.info().attach("backlog-state", {
        body: await (await app.firstWindow()).locator("main").ariaSnapshot(),
        contentType: "text/plain",
      });
    throw error;
  } finally {
    if (saved && app) {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Disconnect", exact: true }),
      ).toHaveCount(0);
    }
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
