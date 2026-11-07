import type { Redactor } from "../../security/src/redaction.ts";
/** Local report only. Upload destinations and automatic transcript collection are deliberately absent. */
export function nativeBugReport(
  input: {
    sessionId: string;
    hint: string;
    piVersion: string;
    platform: string;
    model: string;
  },
  redactor: Redactor,
) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      input.sessionId,
    ) ||
    Object.entries(input).some(
      ([key, value]) =>
        typeof value !== "string" ||
        value.includes("\0") ||
        value.length > (key === "hint" ? 16384 : key === "model" ? 512 : 128),
    )
  )
    throw Error("Invalid bug report input");
  const text =
    JSON.stringify({
      type: "amun-pi-bug-report",
      schemaVersion: 1,
      sessionId: input.sessionId,
      description: redactor.text(input.hint),
      piVersion: input.piVersion,
      platform: input.platform,
      model: redactor.text(input.model),
      transcriptIncluded: false,
      uploaded: false,
    }) + "\n";
  return {
    kind: "export" as const,
    format: "jsonl" as const,
    text,
    review:
      "Local bug report — not uploaded. No transcript or process environment is included. Review before saving or sending it.\n\n" +
      text,
  };
}
