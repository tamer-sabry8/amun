import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { diagnosticEvent } from "../contracts/src/diagnostic.ts";

const server = new McpServer({
  name: "amun-beta-diagnostics",
  version: "0.1.0",
});
const reportRow = z.strictObject({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
  event: diagnosticEvent.shape.event,
  subject: diagnosticEvent.shape.subject,
  elapsed_ms: diagnosticEvent.shape.elapsedMs,
});
const databasePath = process.argv[2];
const tracker = new URL("../../docs/R1-BUGFIXES.md", import.meta.url);
const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
});
server.registerTool(
  "list_beta_issues",
  {
    description: "Read Amun’s R1 bug register, optionally by issue ID.",
    inputSchema: {
      id: z
        .string()
        .regex(/^BF\d{3}$/)
        .optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => {
    const rows = (await readFile(tracker, "utf8"))
      .split("\n")
      .filter(
        (row) =>
          /^\| BF\d{3} /.test(row) && (!id || row.startsWith("| " + id + " ")),
      );
    return textResult(rows.join("\n") || "No matching report.");
  },
);
server.registerTool(
  "query_diagnostics",
  {
    description:
      "Read recent allowlisted local timing and failure measurements from the workspace database selected at startup.",
    inputSchema: {
      event: diagnosticEvent.shape.event.optional(),
      subject: diagnosticEvent.shape.subject.optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ event, subject, limit }) => {
    if (!databasePath)
      return textResult(
        "No diagnostics database selected. Pass a candidate workspace.sqlite path when starting the server.",
      );
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(databasePath, {
        readOnly: true,
        allowExtension: false,
      });
      db.exec("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON");
      if (
        !db
          .prepare(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='diagnostic_events'",
          )
          .get()
      )
        return textResult("This build has no diagnostic_events table.");
      const rows = db
        .prepare(
          "SELECT at,event,subject,elapsed_ms FROM diagnostic_events WHERE (? IS NULL OR event=?) AND (? IS NULL OR subject=?) ORDER BY id DESC LIMIT ?",
        )
        .all(
          event ?? null,
          event ?? null,
          subject ?? null,
          subject ?? null,
          limit,
        );
      const reports = rows.flatMap((row) => {
        const parsed = reportRow.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
      return textResult(JSON.stringify(reports));
    } catch {
      return textResult("The local diagnostics database could not be read.");
    } finally {
      db?.close();
    }
  },
);
await server.connect(new StdioServerTransport());
