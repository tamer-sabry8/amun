import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const adapters = {
  playwright: {
    label: "Playwright",
    entry: "@playwright/mcp/cli.js",
    args: ["--isolated", "--headless", "--browser", "chrome"],
    tool: "browser_tabs",
    params: { action: "list" },
    expected: "### Result\n- 0: (current) [](about:blank)",
  },
  chrome: {
    label: "Chrome DevTools",
    entry: "chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js",
    args: [
      "--isolated",
      "--headless",
      "--no-usage-statistics",
      "--no-performance-crux",
      "--no-javascript-evaluation",
    ],
    tool: "list_pages",
    params: {},
    expected: "## Pages\n1: about:blank [selected]",
  },
} as const;

export async function checkBrowserMcp(
  key: keyof typeof adapters,
  modules: string,
) {
  const adapter = adapters[key];
  // Chromium and Playwright create Unix sockets below TMPDIR on macOS.
  const home = await mkdtemp(
    join(
      process.platform === "darwin" ? "/private/tmp" : tmpdir(),
      "amun-mcp-",
    ),
  );
  const client = new Client({ name: "amun", version: "0.1.0" });
  try {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(modules, adapter.entry), ...adapter.args],
      cwd: home,
      env: {
        HOME: home,
        TMPDIR: home,
        PATH: "/usr/bin:/bin",
        ELECTRON_RUN_AS_NODE: "1",
        CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1",
      },
      stderr: "ignore",
      maxBufferSize: 1048576,
    });
    await client.connect(transport, { timeout: 10000 });
    const result = await client.callTool(
      { name: adapter.tool, arguments: adapter.params },
      undefined,
      { timeout: 20000 },
    );
    if (
      result.isError ||
      !Array.isArray(result.content) ||
      result.content.length !== 1 ||
      result.content[0]?.type !== "text" ||
      result.content[0].text !== adapter.expected
    )
      throw Error("Isolated blank page unavailable");
    return (
      adapter.label + " verified a blank page in an isolated Chrome session."
    );
  } finally {
    try {
      await client.close();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
}
