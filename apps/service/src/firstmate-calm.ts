import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PiRpcClient } from "../../../packages/crew/src/pi-rpc.ts";
import { FirstmateReleases } from "../../../packages/crew/src/firstmate-release.ts";
import { readBoundedPrivateFile } from "../../../packages/crew/src/endpoint-receipt.ts";
import { cleanupExtension } from "./pi-cleanup.ts";

export async function toggleFirstmateCalm(
  releases: FirstmateReleases,
  binary: string,
  entry: string,
) {
  const { home, revision } = await releases.crewHome();
  await releases.verifyHomes(revision, [home]);
  const directory = join(home, "config");
  await mkdir(directory, { mode: 0o700, recursive: true });
  if ((await realpath(directory)) !== directory)
    throw Error("Invalid Firstmate config");
  const preference = join(directory, "calm");
  const before = await readBoundedPrivateFile(preference, 64).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const expected = ["max", "on"].includes(before.trim()) ? "off" : "on";
  await runFirstmateCommand(home, binary, entry, "calm", {});
  if ((await readBoundedPrivateFile(preference, 64)).trim() !== expected)
    throw Error("Calm change unverified");
  return "Firstmate Calm is " + expected + ".";
}
export async function runFirstmateCommand(
  home: string,
  binary: string,
  entry: string,
  name: "calm" | "supervision-model",
  options: {
    authRoot?: string;
    signal?: AbortSignal;
    onFrame?: (frame: Record<string, unknown>, client: PiRpcClient) => void;
  },
) {
  const temp = await realpath(
    await mkdtemp(join(tmpdir(), "amun-pi-service-")),
  );
  try {
    const cleanup = join(temp, "cleanup.ts");
    await writeFile(cleanup, cleanupExtension(temp), {
      flag: "wx",
      mode: 0o600,
    });
    const child = spawn(
      binary,
      [
        entry,
        "--mode",
        "rpc",
        "--offline",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-mcp",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--extension",
        join(
          home,
          ".pi/extensions",
          name === "calm" ? "fm-calm.ts" : "fm-branch-supervision.ts",
        ),
        "--extension",
        cleanup,
      ],
      {
        cwd: temp,
        env: {
          HOME: temp,
          PATH: "/usr/bin:/bin",
          PI_CODING_AGENT_DIR: options.authRoot ?? temp,
          PI_SKIP_VERSION_CHECK: "1",
          PI_OFFLINE: "1",
          FM_HOME: home,
          FM_ROOT_OVERRIDE: home,
          ELECTRON_RUN_AS_NODE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const client = new PiRpcClient(
      (line) => {
        child.stdin.write(line);
      },
      (frame) => {
        if (frame.type === "agent_start") client.close();
        else options.onFrame?.(frame, client);
      },
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (s: string) => client.receive(s));
    child.stderr.resume();
    child.stdin.on("error", () => {});
    const done = new Promise<void>((resolve) => {
      child.once("close", () => {
        client.close();
        resolve();
      });
      child.once("error", () => client.close());
    });
    const abort = () => client.close();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      options.signal?.throwIfAborted();
      const commands = (await client.request("get_commands")) as {
        commands?: { name?: string }[];
      };
      if (!commands.commands?.some((c) => c.name === name))
        throw Error("Pinned command unavailable");
      const result = (await client.request(
        "prompt",
        { message: "/" + name },
        120000,
      )) as {
        disposition?: string;
      };
      if (result.disposition !== "handled")
        throw Error("Firstmate command unavailable");
    } finally {
      options.signal?.removeEventListener("abort", abort);
      client.close();
      child.stdin.end();
      const force = setTimeout(() => child.kill("SIGKILL"), 3000);
      try {
        await done;
      } finally {
        clearTimeout(force);
      }
    }
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}

export async function crewCalmEnabled(workspace: string, archives: string) {
  try {
    await readBoundedPrivateFile(join(workspace, "firstmate-crew-home"), 128);
    const releases = await FirstmateReleases.open(workspace, archives);
    const { home } = await releases.crewHome();
    const config = join(home, "config");
    if ((await realpath(config)) !== config) return false;
    return ["on", "max"].includes(
      (await readBoundedPrivateFile(join(config, "calm"), 64)).trim(),
    );
  } catch {
    return false;
  }
}
