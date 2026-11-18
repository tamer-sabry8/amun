import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Redactor } from "@amun/work-store";
import { TRACE_KEEP_DAYS, TraceLog } from "./trace-log.js";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("TraceLog", () => {
  it("writes one redacted line per event into the day's file", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "amun-trace-"));
    const redactor = new Redactor();
    redactor.register("pat-value-1234567890");
    const log = new TraceLog({ dir, redactor, now: () => new Date("2026-11-18T09:00:00Z") });
    log.record({ source: "connection", kind: "check", note: "token pat-value-1234567890" });
    const lines = readFileSync(path.join(dir, "2026-11-18.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ at: "2026-11-18T09:00:00.000Z", source: "connection" });
    expect(lines[0]).not.toContain("pat-value-1234567890");
  });

  it(`keeps ${TRACE_KEEP_DAYS} days and deletes older day files`, () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "amun-trace-"));
    writeFileSync(path.join(dir, "2026-10-01.jsonl"), "{}\n");
    writeFileSync(path.join(dir, "2026-11-10.jsonl"), "{}\n");
    const log = new TraceLog({ dir, now: () => new Date("2026-11-18T09:00:00Z") });
    expect(log.files()).toEqual(["2026-11-10.jsonl"]);
  });
});
