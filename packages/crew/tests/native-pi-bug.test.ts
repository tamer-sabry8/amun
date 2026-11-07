import { expect, it } from "vitest";
import { nativeBugReport } from "../src/native-pi-bug.ts";
import { Redactor } from "../../security/src/redaction.ts";
it("prepares a local redacted report without transcript, environment or credentials", () => {
  const redactor = new Redactor();
  redactor.register("BUG_SECRET");
  const report = nativeBugReport(
    {
      sessionId: "11111111-1111-4111-8111-111111111111",
      hint: "Failure BUG_SECRET",
      piVersion: "1.4.0",
      platform: "darwin",
      model: "provider/model",
    },
    redactor,
  );
  expect(report.kind).toBe("export");
  expect(report.format).toBe("jsonl");
  expect(report.text).not.toContain("BUG_SECRET");
  expect(report.text).toContain("[REDACTED]");
  const parsed = JSON.parse(report.text);
  expect(parsed.transcriptIncluded).toBe(false);
  expect(parsed.uploaded).toBe(false);
  expect(parsed).not.toHaveProperty("environment");
});
it("rejects malformed identities, excessive hints and control characters", () => {
  const valid = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    hint: "Failure",
    piVersion: "1.4.0",
    platform: "darwin",
    model: "provider/model",
  };
  for (const bad of [
    { sessionId: "../private" },
    { hint: "x".repeat(16385) },
    { hint: "bad\0input" },
    { piVersion: "a".repeat(129) },
  ])
    expect(() =>
      nativeBugReport({ ...valid, ...bad }, new Redactor()),
    ).toThrow();
});
