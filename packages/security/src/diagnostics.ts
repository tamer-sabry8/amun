import type { Redactor } from "./redaction.ts";

const maxLines = 500;
const maxLineLength = 4000;

/** Keeps the most recent log lines in memory; nothing is written to disk. */
export class LogBuffer {
  private lines: string[] = [];
  private partial = "";
  /** A pino-compatible destination stream. */
  write = (chunk: string | Uint8Array): boolean => {
    const text = this.partial + String(chunk);
    const parts = text.split("\n");
    this.partial = parts.pop()!.slice(0, maxLineLength);
    for (const line of parts)
      if (line) this.lines.push(line.slice(0, maxLineLength));
    if (this.lines.length > maxLines)
      this.lines.splice(0, this.lines.length - maxLines);
    return true;
  };
  recent(): string[] {
    return [...this.lines];
  }
}

/** Builds the reviewable diagnostics text, redacting every line again on export. */
export function diagnosticsReport(
  versions: Record<string, string>,
  lines: string[],
  redactor: Redactor,
  now = new Date(),
): string {
  const header = Object.entries(versions).map(
    ([name, value]) => `${name}: ${redactor.text(value)}`,
  );
  const body = lines.length
    ? lines.map((line) => redactor.text(line))
    : ["No log lines have been recorded since Amun started."];
  return [
    "Amun diagnostics",
    `Created: ${now.toISOString()}`,
    "",
    "Versions",
    ...header,
    "",
    `Recent service log (last ${Math.min(lines.length, maxLines)} lines)`,
    ...body,
    "",
  ].join("\n");
}
