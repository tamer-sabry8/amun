import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { workerEnvironment } from "../packages/crew/src/worker-environment.ts";
import { runClosedInput } from "../packages/crew/src/closed-input.ts";
const tool = process.argv[2];
if (tool !== "codex" && tool !== "claude")
  throw Error("Select codex or claude");
const profile = join(
  homedir(),
  "Library/Application Support/Amun/workers",
  "m0-" + tool,
);
const marker = "AMUN_M1_" + tool.toUpperCase() + "_OK";
const args =
  tool === "codex"
    ? [
        "exec",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        `Reply exactly ${marker}. Do not use tools or access files.`,
      ]
    : [
        "--print",
        "--restricted",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--no-session-persistence",
        "--output-format",
        "json",
        `Reply exactly ${marker}. Do not use tools or access files.`,
      ];
try {
  const { stdout } = await runClosedInput(
    join(homedir(), ".local/bin", tool),
    args,
    {
      cwd: join(profile, "work"),
      env: {
        ...workerEnvironment(tool, homedir(), profile, process.execPath),
        USER: userInfo().username,
        LOGNAME: userInfo().username,
        TMPDIR: process.env.TMPDIR ?? "/tmp",
      },
      timeout: 90000,
      maxBuffer: 524288,
    },
  );
  let completed = false,
    exactReply = false,
    toolItems = 0;
  if (tool === "codex") {
    const events = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    completed = events.some((e) => e.type === "turn.completed");
    exactReply = events.some(
      (e) =>
        e.type === "item.completed" &&
        e.item?.type === "agent_message" &&
        e.item.text?.trim() === marker,
    );
    toolItems = events.filter((e) =>
      [
        "command_execution",
        "mcp_tool_call",
        "file_change",
        "web_search",
      ].includes(e.item?.type),
    ).length;
  } else {
    const result = JSON.parse(stdout);
    completed = result.type === "result" && !result.is_error;
    exactReply = result.result?.trim() === marker;
  }
  console.log(
    JSON.stringify({
      tool,
      completed,
      exactReply,
      ...(tool === "codex" ? { toolItems } : {}),
      privateProfile: true,
    }),
  );
  if (!completed || !exactReply || toolItems) process.exitCode = 1;
} catch {
  console.error(
    "Subscription inference proof failed; runtime details withheld",
  );
  process.exitCode = 1;
}
