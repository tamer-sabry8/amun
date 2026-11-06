import { workerEnvironment } from "../packages/crew/src/worker-environment.ts";
/** Run in a visible local Terminal. Never redirect login output into evidence/chat. */
import { spawn, execFile } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { prepareWorkerProfile } from "../packages/crew/src/worker-profile.ts";
import { WorkerLoginBrowser } from "../packages/crew/src/worker-login-url.ts";
import { withRefreshLock } from "../packages/auth/src/broker.ts";
import { SubscriptionWorker } from "../packages/crew/src/subscription-worker.ts";
async function main() {
  const tool = process.argv[2];
  if (tool !== "claude" && tool !== "codex")
    throw new Error("Choose claude or codex");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Run this sign-in helper in a visible Terminal");
  const root = await prepareWorkerProfile(
    join(homedir(), "Library/Application Support/Amun/workers"),
    tool,
  );
  await withRefreshLock(root, async () => {
    const current = new SubscriptionWorker({
      home: homedir(),
      binary: process.execPath,
      tool,
    });
    try {
      if ((await current.status()).includes("subscription configured")) {
        process.stdout.write(
          "Your Amun subscription profile is already signed in. Return to Amun and check provider status or verify inference.\n",
        );
        return;
      }
    } catch {
      /* Official status may exit nonzero for a missing sign-in. */
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
      ...(tool === "codex" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      USER: userInfo().username,
      LOGNAME: userInfo().username,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
    };

    const child = spawn(
      tool === "codex" ? process.execPath : join(homedir(), ".local/bin", tool),
      tool === "claude"
        ? ["auth", "login", "--claudeai"]
        : [join(homedir(), ".local/bin", tool), "login"],
      { cwd: join(root, "work"), env, stdio: ["inherit", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve) => {
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
        resolve();
      });
      child.on("close", (code) => {
        process.exitCode = code ?? 1;
        resolve();
      });
    });
  });
}
void main().catch(() => {
  process.stderr.write(
    "Sign-in could not start. Another Amun sign-in may be active, or the private profile is unavailable.\n",
  );
  process.exitCode = 1;
});
