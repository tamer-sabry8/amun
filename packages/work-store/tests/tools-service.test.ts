import { describe, expect, it } from "vitest";
import { toolsReport } from "../../contracts/src/work.ts";
import { migrate } from "../src/database.ts";
import { openDatabase } from "../src/sqlite.ts";
import { ToolsService } from "../src/tools-service.ts";

function service() {
  const db = openDatabase(":memory:");
  migrate(db);
  const asked: string[][] = [];
  const tools = new ToolsService(db, async (list) => {
    asked.push(list.map((tool) => tool.id));
    return {
      codex: {
        found: true,
        path: "/opt/homebrew/bin/codex",
        versionText: "codex-cli 0.48.1",
      },
    };
  });
  return { tools, asked };
}
const command = (rest: Record<string, unknown>) => ({
  version: 1,
  kind: "tools",
  ...rest,
});

describe("tools already on this Mac", () => {
  it("reports what was found in the shape the screen reads", async () => {
    const { tools, asked } = service();
    const report = toolsReport.parse(
      await tools.handle(command({ action: "refresh" })),
    );
    expect(asked[0]).toContain("claude_code");
    expect(report.tools.find((tool) => tool.id === "codex")).toMatchObject({
      status: "ready",
      version: "0.48.1",
      path: "/opt/homebrew/bin/codex",
    });
    expect(report.tools.find((tool) => tool.id === "gemini")?.status).toBe(
      "not_installed",
    );
  });

  it("remembers a tool the owner turned off", async () => {
    const { tools } = service();
    await tools.handle(
      command({ action: "enable", id: "codex", enabled: false }),
    );
    const report = toolsReport.parse(
      await tools.handle(command({ action: "refresh" })),
    );
    expect(report.tools.find((tool) => tool.id === "codex")?.status).toBe(
      "disabled",
    );
  });

  it("says why a change was refused and still reports", async () => {
    const { tools } = service();
    const report = toolsReport.parse(
      await tools.handle(
        command({ action: "add", label: "My tool", path: "relative/path" }),
      ),
    );
    expect(report.message).toBe("Give the tool's absolute path");
    expect(report.tools.length).toBeGreaterThan(0);
  });

  it("refuses anything that is not a tools command", async () => {
    const { tools } = service();
    await expect(
      tools.handle({ version: 1, kind: "tools", action: "run", id: "codex" }),
    ).rejects.toThrow();
  });
});
