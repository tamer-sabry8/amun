import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { SafeOutputs } from "../src/audit.ts";
import { Redactor, createSafeLogger } from "../../security/src/redaction.ts";
it("canary never appears in real audit, log, export, memory or update output", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Product",
    "now",
  );
  db.prepare(
    "INSERT INTO sources(id,product_id,kind,title,retrieved_at,hash) VALUES (?,?,?,?,?,?)",
  ).run("s", "p", "doc", "Source", "now", "hash");
  const secret = "CANARY-audit-memory-update-492";
  const redactor = new Redactor();
  redactor.register(secret);
  let logs = "";
  const logger = createSafeLogger(redactor, {
    write(chunk: string) {
      logs += chunk;
    },
  });
  const outputs = new SafeOutputs(db, redactor, logger);
  outputs.audit("system", "test.event", "ref", {
    text: secret,
    credentials: "hidden",
  });
  outputs.memory({
    id: "memory",
    productId: "p",
    sourceId: "s",
    type: "fact",
    data: { text: secret, token: "hidden" },
  });
  outputs.update("p", "worker", secret, "ref");
  const exported = outputs.exportAudit();
  for (const output of [
    logs,
    exported,
    JSON.stringify(db.prepare("SELECT * FROM audit_log").all()),
    JSON.stringify(db.prepare("SELECT * FROM memory_entities").all()),
    JSON.stringify(db.prepare("SELECT * FROM notifications").all()),
  ]) {
    expect(output).not.toContain(secret);
    expect(output).not.toContain("hidden");
  }
  expect(JSON.parse(exported)).toHaveLength(1);
  db.close();
});
it("refuses memory without provenance and unknown actors without writing partial records", () => {
  const db = new Database(":memory:");
  migrate(db);
  const redactor = new Redactor();
  const outputs = new SafeOutputs(
    db,
    redactor,
    createSafeLogger(redactor, { write() {} }),
  );
  expect(() =>
    outputs.audit("invented" as never, "event", "ref", {}),
  ).toThrow();
  expect(() =>
    outputs.memory({
      id: "m",
      productId: "missing",
      sourceId: "missing",
      type: "fact",
      data: {},
    }),
  ).toThrow();
  expect(db.prepare("SELECT count(*) n FROM audit_log").get()).toEqual({
    n: 0,
  });
  db.close();
});
