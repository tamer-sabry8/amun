import { workerProfileName } from "./worker-profile.ts";
import { join } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { workerEnvironment } from "./worker-environment.ts";
import { runClosedInput } from "./closed-input.ts";
async function validateProfile(root: string) {
  for (const path of [
    root,
    join(root, "state"),
    join(root, "work"),
    join(root, "home"),
  ]) {
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.() ||
      (await realpath(path)) !== path
    )
      throw Error("Unsafe worker profile");
  }
}
export class SubscriptionWorker {
  private root: string;
  private label: string;
  constructor(
    private config: {
      home: string;
      binary: string;
      tool: "codex" | "claude";
      signal?: AbortSignal;
      instanceId?: string;
    },
    private run: typeof runClosedInput = runClosedInput,
    private validate: typeof validateProfile = validateProfile,
  ) {
    this.root = join(
      config.home,
      "Library/Application Support/Amun/workers",
      workerProfileName(config.tool, config.instanceId),
    );
    this.label = config.tool === "codex" ? "Codex CLI" : "Claude Code CLI";
    workerEnvironment(config.tool, config.home, this.root, config.binary);
  }
  private async execute(args: string[]) {
    await this.validate(this.root);
    const { tool, home, binary } = this.config;
    const launcher = join(home, ".local/bin", tool);
    return this.run(
      tool === "codex" ? binary : launcher,
      tool === "codex" ? [launcher, ...args] : args,
      {
        cwd: join(this.root, "work"),
        env: {
          ...workerEnvironment(tool, home, this.root, binary),
          ...(tool === "codex" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          USER: userInfo().username,
          LOGNAME: userInfo().username,
          TMPDIR: process.env.TMPDIR ?? "/tmp",
        },
        ...(this.config.signal ? { signal: this.config.signal } : {}),
        timeout: 90000,
        maxBuffer: 524288,
      },
    );
  }
  async status() {
    const { stdout, stderr } = await this.execute(
      this.config.tool === "codex"
        ? ["login", "status"]
        : ["auth", "status", "--json"],
    );
    let ready = false;
    if (this.config.tool === "codex")
      ready = /Logged in using ChatGPT/i.test(stdout + stderr);
    else {
      const result = JSON.parse(stdout);
      ready = result.loggedIn === true && result.authMethod === "claude.ai";
    }
    return (
      this.label +
      (ready
        ? " subscription configured; inference has not been checked."
        : " subscription is not configured in the Amun profile.")
    );
  }
  async infer() {
    const tool = this.config.tool,
      marker = "AMUN_M1_" + tool.toUpperCase() + "_OK";
    const prompt = `Reply exactly ${marker}. Do not use tools or access files.`;
    const { stdout } = await this.execute(
      tool === "codex"
        ? [
            "exec",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--json",
            prompt,
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
            prompt,
          ],
    );
    if (tool === "codex") {
      const events = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      if (
        !events.some((e) => e.type === "turn.completed") ||
        !events.some(
          (e) =>
            e.type === "item.completed" &&
            e.item?.type === "agent_message" &&
            e.item.text?.trim() === marker,
        ) ||
        events.some((e) =>
          [
            "command_execution",
            "mcp_tool_call",
            "file_change",
            "web_search",
          ].includes(e.item?.type),
        )
      )
        throw Error("Inference not verified");
    } else {
      const result = JSON.parse(stdout);
      if (
        result.type !== "result" ||
        result.is_error ||
        result.result?.trim() !== marker
      )
        throw Error("Inference not verified");
    }
    return this.label + " subscription inference completed successfully.";
  }
}
