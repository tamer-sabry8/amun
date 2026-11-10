import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { migrations } from "../../data/src/migrations.ts";

it("queries one report and filters a disposable timing database over MCP", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-diagnostics-mcp-"));
  const path = join(root, "workspace.sqlite");
  const client = new Client({ name: "amun-test", version: "1" });
  try {
    const db = new DatabaseSync(path);
    try {
      const schema = migrations.find((sql) =>
        sql.startsWith("CREATE TABLE diagnostic_events"),
      );
      if (!schema) throw Error("Missing diagnostics migration");
      db.exec(schema);
      db.exec(
        "INSERT INTO diagnostic_events(event,subject,elapsed_ms) VALUES ('login-first-dialog','openai',42),('provider-error','openrouter',NULL)",
      );
    } finally {
      db.close();
    }
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL("../server.ts", import.meta.url)), path],
      }),
    );
    const issue = await client.callTool({
      name: "list_beta_issues",
      arguments: { id: "BF012" },
    });
    expect(JSON.stringify(issue.content)).toContain("Copilot pairing code");
    const result = await client.callTool({
      name: "query_diagnostics",
      arguments: { subject: "openai" },
    });
    expect(JSON.stringify(result.content)).toContain("login-first-dialog");
    expect(JSON.stringify(result.content)).not.toContain("openrouter");
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
