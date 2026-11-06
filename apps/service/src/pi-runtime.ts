import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PiEvent } from "@amun/contracts";
import { PiSession } from "./pi-session.ts";
/** Offline protocol proof. No personal config, provider keys, skills or MCPs are loaded. */
export async function openPiProtocol(
  binary: string,
  entry: string,
  send: (event: PiEvent) => void,
): Promise<PiSession> {
  const root = await mkdtemp(join(tmpdir(), "amun-pi-service-"));
  try {
    const config = join(root, "config");
    await mkdir(config, { mode: 0o700 });
    const extension = join(root, "dialog-proof.ts");
    await writeFile(
      extension,
      `export default function(pi){pi.registerCommand("amun-dialog-proof",{description:"Offline explicit dialog proof",handler:async(_args,ctx)=>{const value=await ctx.ui.select("Select proof option",["Option one","Option two"]);if(value!==undefined)await ctx.ui.confirm("Confirm proof selection","Continue with this option?");}});}`,
      { mode: 0o600 },
    );
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
        extension,
      ],
      {
        cwd: root,
        env: {
          HOME: root,
          PATH: "",
          PI_CODING_AGENT_DIR: config,
          PI_SKIP_VERSION_CHECK: "1",
          PI_OFFLINE: "1",
          ELECTRON_RUN_AS_NODE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let force: ReturnType<typeof setTimeout> | undefined;
    const session = new PiSession(
      (line) => {
        child.stdin.write(line);
      },
      send,
      () => {
        clearTimeout(timer);
        child.kill();
        if (child.exitCode === null && child.signalCode === null)
          force = setTimeout(() => child.kill("SIGKILL"), 3000);
      },
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => session.receive(chunk));
    child.stderr.resume();
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(force);
      session.close();
      void rm(root, { recursive: true, force: true });
    };
    child.once("exit", cleanup);
    child.once("error", cleanup);
    child.stdin.on("error", () => session.close());
    const timer = setTimeout(() => session.close(), 300000);
    send({ version: 1, kind: "pi-state", state: "ready" });
    return session;
  } catch {
    await rm(root, { recursive: true, force: true });
    throw new Error("Pi runtime unavailable");
  }
}
