import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { PiRpcClient } from "../packages/crew/src/pi-rpc.ts";

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
const client = new PiRpcClient((line) => {
  child.stdin.write(line);
});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => client.receive(chunk));
child.stdout.on("end", () => client.close());
child.stdin.on("error", () => client.close());
child.once("error", () => client.close());
child.once("exit", () => client.close());
// Do not print runtime stderr: it can contain provider or local configuration details.
child.stderr.resume();
try {
  await Promise.all(
    ["get_state", "get_available_models"].map(async (command) => {
      const data = await client.request(command);
      if (!data || typeof data !== "object")
        throw new Error("Invalid Pi discovery response");
      if (
        command === "get_available_models" &&
        !("models" in data && Array.isArray(data.models))
      )
        throw new Error("Invalid Pi model discovery response");
      console.log(JSON.stringify({ command, success: true }));
    }),
  );
} finally {
  client.close();
  child.kill();
  const force = setTimeout(() => child.kill("SIGKILL"), 3000);
  await new Promise<void>((resolveExit) => {
    if (
      child.exitCode !== null ||
      child.signalCode !== null ||
      child.pid === undefined
    )
      resolveExit();
    else child.once("exit", () => resolveExit());
  });
  clearTimeout(force);
  await rm(root, { recursive: true, force: true });
}
