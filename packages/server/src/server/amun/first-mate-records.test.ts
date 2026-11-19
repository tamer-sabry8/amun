import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FirstMateRecords } from "./first-mate-records.js";

describe("which agent is each home's First Mate", () => {
  it("is kept per home in Amun's own folder, readable by the owner only", () => {
    const amunHome = mkdtempSync(path.join(tmpdir(), "amun-fm-"));
    const records = new FirstMateRecords(amunHome);
    expect(records.read("/a")).toBeNull();
    records.write("/a", "fm-1");
    records.write("/b", "fm-2");
    expect(new FirstMateRecords(amunHome).read("/a")).toBe("fm-1");
    expect(records.read("/b")).toBe("fm-2");
    const file = path.join(amunHome, "first-mates.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ "/a": "fm-1", "/b": "fm-2" });
  });

  it("treats a damaged file as no record", () => {
    const amunHome = mkdtempSync(path.join(tmpdir(), "amun-fm-"));
    writeFileSync(path.join(amunHome, "first-mates.json"), "{not json");
    expect(new FirstMateRecords(amunHome).read("/a")).toBeNull();
  });
});
