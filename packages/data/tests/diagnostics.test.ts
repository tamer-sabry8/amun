import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { diagnosticEvent } from "../../contracts/src/diagnostic.ts";
import {
  recordDiagnostics,
  sqliteDiagnosticExporter,
} from "../src/diagnostic-exporter.ts";
import { migrate } from "../src/database.ts";

it("accepts only named measurements and keeps the latest 2000 records", () => {
  const sample = {
    version: 1,
    kind: "diagnostic",
    event: "dialog-frame",
    subject: "auth",
    elapsedMs: 34,
  };
  expect(diagnosticEvent.safeParse(sample).success).toBe(true);
  expect(
    diagnosticEvent.safeParse({ ...sample, message: "private" }).success,
  ).toBe(false);
  expect(
    diagnosticEvent.safeParse({ ...sample, subject: "private" }).success,
  ).toBe(false);
  const db = new Database(":memory:");
  try {
    migrate(db);
    const record = recordDiagnostics(sqliteDiagnosticExporter(db));
    for (let i = 0; i < 2002; i++) record({ ...sample, elapsedMs: i });
    expect(
      db
        .prepare(
          "SELECT count(*) n, min(elapsed_ms) oldest FROM diagnostic_events",
        )
        .get(),
    ).toEqual({ n: 2000, oldest: 2 });
  } finally {
    db.close();
  }
});

it("passes only approved fields to diagnostic exporters and ignores malformed events", () => {
  const reports: unknown[] = [];
  const record = recordDiagnostics({
    export(report) {
      reports.push(report);
    },
  });
  const event = {
    version: 1,
    kind: "diagnostic",
    event: "dialog-frame",
    subject: "auth",
    elapsedMs: 12,
  };
  record({
    ...event,
    prompt: "private prompt",
    path: "/Users/private",
    token: "private-token",
    content: "private draft",
  });
  record({ ...event, subject: "/Users/private" });
  record(event);
  expect(reports).toEqual([
    { event: "dialog-frame", subject: "auth", elapsedMs: 12 },
  ]);
});
