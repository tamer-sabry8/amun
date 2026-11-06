import { workerEnvironment } from "../packages/crew/src/worker-environment.ts";
/** Run in a visible local Terminal. Never redirect login output into evidence/chat. */
import { spawn, execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { WorkerLoginBrowser } from "../packages/crew/src/worker-login-url.ts";
const tool = process.argv[2];
if (tool !== "claude" && tool !== "codex")
  throw new Error("Choose claude or codex");
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error("Run this sign-in helper in a visible Terminal");
const root = join(
  homedir(),
  "Library/Application Support/Amun/workers",
  "m0-" + tool,
);
for (const path of [root, join(root, "state"), join(root, "work")]) {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await realpath(path)) !== path ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error("Unsafe worker profile");
}
const bridge = new WorkerLoginBrowser(tool, (url) => {
  execFile("/usr/bin/open", ["-a", "Microsoft Edge", url], (error) => {
    if (error)
      process.stderr.write(
        "Microsoft Edge could not be opened. Use the official login URL shown above.\n",
      );
  });
});
const env = {
  ...workerEnvironment(tool, homedir(), root, process.execPath),
  USER: userInfo().username,
  LOGNAME: userInfo().username,
  TMPDIR: process.env.TMPDIR ?? "/tmp",
};

const child = spawn(
  join(homedir(), ".local/bin", tool),
  tool === "claude" ? ["auth", "login", "--claudeai"] : ["login"],
  { cwd: join(root, "work"), env, stdio: ["inherit", "pipe", "pipe"] },
);
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    process.stdout.write(chunk);
    bridge.receive(chunk);
  });
}
child.on("error", () => {
  process.stderr.write("Official CLI could not start.\n");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
