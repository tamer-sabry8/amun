import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { selectedCodexAccessToken } from "../packages/crew/src/codex-credential.ts";
const root = await mkdtemp(join(tmpdir(), "amun-codex-access-"));
const authPath = join(homedir(), ".codex/auth.json");
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
const before = hash(await readFile(authPath));
try {
  const state = join(root, "codex");
  await mkdir(state, { mode: 0o700 });
  await writeFile(
    join(state, "config.toml"),
    'cli_auth_credentials_store = "file"\nsandbox_mode = "read-only"\napproval_policy = "never"\n',
    { mode: 0o600, flag: "wx" },
  );
  const env = {
    HOME: root,
    CODEX_HOME: state,
    PATH: join(process.execPath, "..") + ":/usr/bin:/bin",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
  };
  const binary = join(homedir(), ".local/bin/codex");
  const run = (args: string[], input: string, timeout: number) =>
    new Promise<{ code: number | null; output: string; diagnostics: string[] }>(
      (resolve, reject) => {
        const child = spawn(binary, args, {
          cwd: root,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "";
        let exceeded = false;
        const diagnostics = new Set<string>();
        const timer = setTimeout(() => {
          exceeded = true;
          child.kill("SIGKILL");
        }, timeout);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (output.length + chunk.length > 524288) {
            exceeded = true;
            child.kill("SIGKILL");
          } else output += chunk;
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          for (const label of [
            "not supported",
            "unexpected argument",
            "invalid token",
            "refresh",
            "ChatGPT",
            "API key",
            "expired",
            "permission",
            "No such file",
            "node",
            "Usage",
            "JSON",
            "401",
            "403",
            "409",
            "500",
            "stdin",
            "account",
          ])
            if (chunk.toLowerCase().includes(label.toLowerCase()))
              diagnostics.add(label);
        });
        child.stdin.on("error", () => {});
        child.once("error", () => {
          clearTimeout(timer);
          reject(new Error("CLI unavailable"));
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (exceeded) reject(new Error("CLI proof exceeded limits"));
          else resolve({ code, output, diagnostics: [...diagnostics] });
        });
        child.stdin.end(input);
      },
    );
  let token = selectedCodexAccessToken(
    JSON.parse(await readFile(authPath, "utf8")),
  );
  const login = await run(
    ["login", "--with-access-token"],
    token + "\n",
    20000,
  );
  token = "";
  console.log(
    JSON.stringify({
      isolatedHome: true,
      accessTokenOnly: true,
      loginAccepted: login.code === 0,
      exitCode: login.code,
      diagnosticCategories: login.diagnostics,
      refreshTokenCopied: false,
    }),
  );
  if (login.code !== 0) throw new Error("Selected credential login rejected");
  const status = await run(["login", "status"], "", 10000);
  if (status.code !== 0) throw new Error("Isolated CLI not ready");
  const result = await run(
    [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--json",
      "Reply exactly AMUN_CODEX_OK. Do not call tools or access files.",
    ],
    "",
    90000,
  );
  let complete = false,
    expected = false,
    toolUsed = false;
  for (const line of result.output.split("\n")) {
    if (!line) continue;
    const frame = JSON.parse(line) as {
      type?: string;
      item?: { type?: string; text?: string };
    };
    if (frame.type === "turn.completed") complete = true;
    if (
      frame.item?.type === "agent_message" &&
      frame.item.text?.trim() === "AMUN_CODEX_OK"
    )
      expected = true;
    if (
      frame.item?.type &&
      [
        "command_execution",
        "mcp_tool_call",
        "web_search",
        "file_change",
      ].includes(frame.item.type)
    )
      toolUsed = true;
  }
  console.log(
    JSON.stringify({
      authenticatedInference:
        result.code === 0 && complete && expected && !toolUsed,
      complete,
      expectedReply: expected,
      toolUsed,
      isolatedHome: true,
      ephemeralSession: true,
    }),
  );
  if (result.code !== 0 || !complete || !expected || toolUsed)
    process.exitCode = 1;
} catch {
  console.error(
    "Codex isolated acceptance incomplete; credential and provider details withheld",
  );
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  const unchanged = hash(await readFile(authPath)) === before;
  console.log(JSON.stringify({ personalCredentialFileUnchanged: unchanged }));
  if (!unchanged) process.exitCode = 1;
}
