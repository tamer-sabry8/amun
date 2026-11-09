import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { launchMacWorkspace } from "../support/mac-workspace.ts";

for (const fault of ["kill publisher", "drop response"] as const) {
  test(
    fault +
      " after remote commit keeps one external record and exposes unknown after restart",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "amun-chaos-"));
      const dir = join(root, "workspace");
      const records: string[] = [];
      const server = createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        let body = "";
        for await (const chunk of req) body += chunk;
        records.push(JSON.parse(body).text);
        if (fault === "drop response") res.destroy();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = (server.address() as { port: number }).port;
      const worker = spawn(
        process.execPath,
        [
          "--experimental-transform-types",
          "tests/support/chaos-publication.ts",
          dir,
          String(port),
        ],
        { stdio: "inherit" },
      );
      const exit = once(worker, "exit");
      let app: Awaited<ReturnType<typeof launchMacWorkspace>> | undefined;
      try {
        await expect.poll(() => records.length).toBe(1);
        if (fault === "kill publisher") worker.kill("SIGKILL");
        expect(await exit).toEqual(
          fault === "kill publisher" ? [null, "SIGKILL"] : [0, null],
        );
        app = await launchMacWorkspace(root);
        const page = await app.firstWindow();
        await page
          .getByRole("button", { name: "Open conversations", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Open Pi commands", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Published conversations", exact: true })
          .click();
        await expect(
          page.getByRole("region", { name: "Unconfirmed publications" }),
        ).toContainText("Interrupted publication");
        const Database = createRequire(resolve("packages/data/package.json"))(
          "better-sqlite3",
        );
        const db = new Database(join(dir, "workspace.sqlite"), {
          readonly: true,
        });
        try {
          const row = db
            .prepare(
              "SELECT a.id,a.state,o.attempt,d.state AS delivery FROM actions a JOIN outbox o ON o.action_id=a.id JOIN notion_delivery d ON d.action_id=a.id",
            )
            .get();
          expect(row).toMatchObject({
            state: "unknown",
            attempt: 1,
            delivery: "sent-unknown",
          });
          expect(records).toEqual([
            "Synthetic chaos fixture\n\nAmun publication ID: " + row.id,
          ]);
        } finally {
          db.close();
        }
      } finally {
        if (worker.exitCode === null && worker.signalCode === null)
          worker.kill("SIGKILL");
        await app?.close();
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
