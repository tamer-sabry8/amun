import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../src/database.ts";
import { ActionStore } from "../src/outbox.ts";
it("SIGKILL after actual HTTP commit but before acknowledgement reconciles with zero duplicates across ten restarts", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-outbox-chaos-"));
  const file = join(root, "workspace.sqlite");
  const db = new Database(file);
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Chaos",
    "now",
  );
  const store = new ActionStore(db);
  const records: string[] = [];
  let committed: () => void = () => {};
  const server = createServer((req, res) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        records.push((JSON.parse(body) as { marker: string }).marker);
        committed(); /* Deliberately withhold ACK until the client is killed. */
      });
    } else {
      const marker = new URL(req.url!, "http://localhost").searchParams.get(
        "marker",
      );
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          state: records.includes(marker ?? "") ? "found" : "absent",
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  const url = `http://127.0.0.1:${address.port}/`;
  const children = new Set<ReturnType<typeof spawn>>();
  const launch = () => {
    const child = spawn(
      process.execPath,
      ["packages/data/tests/fixtures/outbox-child.ts", file, url],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  };
  try {
    for (let trial = 0; trial < 10; trial++) {
      const id = "action-" + trial;
      store.propose({
        id,
        productId: "p",
        kind: "publish",
        payload: { title: "Test" },
        revisions: { rev: 1 },
        requestedBy: "pm",
        operationMarker: id,
      });
      store.approve(id, "pm");
      const commit = new Promise<void>((resolve) => {
        committed = resolve;
      });
      const child = launch();
      let error = "";
      child.stderr!.on("data", (chunk) => {
        error += chunk;
      });
      await Promise.race([
        commit,
        once(child, "exit").then(() => {
          throw Error("Child exited before commit: " + error);
        }),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(Error("Commit timeout")), 5000);
          timer.unref();
        }),
      ]);
      const stopped = once(child, "exit");
      child.kill("SIGKILL");
      await stopped;
      expect(store.read(id).state).toBe("executing");
      const restarted = launch();
      let restartedError = "";
      restarted.stderr!.on("data", (chunk) => {
        restartedError += chunk;
      });
      const [code] = await once(restarted, "exit");
      expect(code, restartedError).toBe(0);
      expect(store.read(id).state).toBe("succeeded");
      expect(records.filter((marker) => marker === id)).toHaveLength(1);
    }
    expect(records).toHaveLength(10);
  } finally {
    for (const child of children) child.kill("SIGKILL");
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
