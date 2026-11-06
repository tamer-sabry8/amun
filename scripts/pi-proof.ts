import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { JsonLineDecoder } from "../packages/crew/src/jsonl.ts";

const root = await mkdtemp(join(tmpdir(), "amun-pi-proof-"));
const config = join(root, "config");
await mkdir(config, { mode: 0o700 });
const env: NodeJS.ProcessEnv = {};
for (const key of [
  "PATH",
  "HOME",
  "TMPDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
]) {
  if (process.env[key]) env[key] = process.env[key];
}
env.PI_CODING_AGENT_DIR = config;
env.PI_SKIP_VERSION_CHECK = "1";
if (process.argv[3]) {
  env.ELECTRON_RUN_AS_NODE = "1";
  env.PATH = "";
}
const child = spawn(
  process.argv[3] ?? process.execPath,
  [
    process.argv[2] ??
      resolve(
        "runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js",
      ),
    "--no-session",
  ],
  { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] },
);
const decoder = new JsonLineDecoder();
child.stdout.setEncoding("utf8");
// Do not print runtime stderr: it can contain provider or local configuration details.
child.stderr.resume();
try {
  await new Promise<void>((resolveProof, reject) => {
    const pending = new Set(["state", "models"]);
    const timer = setTimeout(
      () => reject(new Error("Pi RPC proof timed out")),
      15000,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (pending.size)
        reject(new Error(`Pi exited before responses (${code})`));
    });
    child.stdout.on("data", (chunk: string) => {
      try {
        for (const frame of decoder.push(chunk)) {
          if (!frame || typeof frame !== "object") continue;
          const record = frame as Record<string, unknown>;
          if (
            record.type !== "response" ||
            typeof record.id !== "string" ||
            !pending.has(record.id)
          )
            continue;
          if (record.success !== true)
            throw new Error(`Pi ${record.id} command failed`);
          pending.delete(record.id);
          console.log(
            JSON.stringify({
              id: record.id,
              command: record.command,
              success: true,
            }),
          );
        }
        if (!pending.size) {
          clearTimeout(timer);
          resolveProof();
        }
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
    child.stdin.write(
      '{"id":"state","type":"get_state"}\n{"id":"models","type":"get_available_models"}\n',
    );
  });
} finally {
  child.kill();
  await new Promise<void>((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) resolveExit();
    else child.once("exit", () => resolveExit());
  });
  await rm(root, { recursive: true, force: true });
}
