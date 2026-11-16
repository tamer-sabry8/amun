import { expect, it } from "vitest";
import { Redactor } from "../src/redaction.ts";
import { LogBuffer, diagnosticsReport } from "../src/diagnostics.ts";

it("keeps only recent complete lines", () => {
  const buffer = new LogBuffer();
  buffer.write("a\nb");
  buffer.write("c\n");
  for (let i = 0; i < 600; i++) buffer.write(`line ${i}\n`);
  const lines = buffer.recent();
  expect(lines).toHaveLength(500);
  expect(lines.at(-1)).toBe("line 599");
  expect(lines).not.toContain("a");
});

it("redacts registered secrets and token patterns again on export", () => {
  const redactor = new Redactor();
  redactor.register("hunter2-registered");
  const text = diagnosticsReport(
    { "Amun version": "1.0.0" },
    [
      '{"msg":"late secret hunter2-registered"}',
      "Authorization: Bearer abc.def.ghi",
      "token=ghp_" + "a".repeat(30),
    ],
    redactor,
    new Date("2026-11-15T00:00:00Z"),
  );
  expect(text).toContain("Amun version: 1.0.0");
  expect(text).toContain("2026-11-15T00:00:00.000Z");
  expect(text).not.toContain("hunter2-registered");
  expect(text).not.toContain("abc.def.ghi");
  expect(text).not.toContain("ghp_");
});

it("says so when there are no log lines", () => {
  expect(diagnosticsReport({}, [], new Redactor())).toContain("No log lines");
});
