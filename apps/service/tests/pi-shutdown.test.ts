import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanupExtension } from "../src/pi-cleanup.ts";

it("lets the real Pi runtime finish supervision shutdown before removing its private root", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-pi-service-"));
  const fixture = await mkdtemp(join(tmpdir(), "amun-quit-test-"));
  const marker = join(fixture, "stopped");
  try {
    const cleanup = join(root, "cleanup.ts");
    await writeFile(cleanup, cleanupExtension(root));
    const observer = join(root, "watch.ts");
    await writeFile(
      observer,
      `import {writeFile} from "node:fs/promises";
export default function(pi) {
  pi.on("session_shutdown", async () => {
    await new Promise(done => setTimeout(done, 100));
    await writeFile(${JSON.stringify(marker)}, "paused");
  });
}`,
    );
    const entry = resolve(
      "runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    );
    const child = spawn(
      process.execPath,
      [
        entry,
        "--mode",
        "rpc",
        "--offline",
        "--no-session",
        "--no-extensions",
        "--no-tools",
        "--extension",
        cleanup,
        "--extension",
        observer,
      ],
      {
        cwd: fixture,
        env: {
          HOME: fixture,
          PI_CODING_AGENT_DIR: fixture,
          PATH: "/usr/bin:/bin",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
    try {
      child.stderr.resume();
      const exit = once(child, "exit");
      const output = createInterface({ input: child.stdout });
      child.stdin.write(
        JSON.stringify({ id: "ready", type: "get_state" }) + "\n",
      );
      let ready = false;
      for await (const line of output) {
        const frame = JSON.parse(line);
        if (frame.id === "ready" && frame.success === true) {
          ready = true;
          child.stdin.end();
        }
      }
      expect(ready).toBe(true);
      expect((await exit)[0]).toBe(0);
      expect(await readFile(marker, "utf8")).toBe("paused");
      await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(fixture, { recursive: true, force: true });
  }
}, 20000);
