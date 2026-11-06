import { isAbsolute, join, dirname, resolve } from "node:path";
/** Explicit environment, never a spread of personal shell variables or credential values. */
export function workerEnvironment(
  tool: "claude" | "codex",
  normalHome: string,
  profile: string,
  nodeBinary: string,
): NodeJS.ProcessEnv {
  for (const path of [normalHome, profile, nodeBinary])
    if (!isAbsolute(path) || resolve(path) !== path || /[\0\r\n]/.test(path))
      throw Error("Unsafe worker path");
  return {
    HOME: tool === "claude" ? normalHome : join(profile, "home"),
    PATH: dirname(nodeBinary) + ":/usr/bin:/bin",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    [tool === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"]: join(
      profile,
      "state",
    ),
  };
}
