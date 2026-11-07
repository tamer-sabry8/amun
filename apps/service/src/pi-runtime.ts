import bridgeSource from "../../../packages/pi-bridge/src/extension.ts?raw";
import clientSource from "../../../packages/pi-bridge/src/client.ts?raw";
import gateSource from "../../../packages/pi-bridge/src/gate.ts?raw";
import { openBridge } from "../../../packages/pi-bridge/src/socket.ts";
import type { BridgeRequest } from "../../../packages/contracts/src/pi-bridge.ts";
import { cleanupExtension } from "./pi-cleanup.ts";
import { pathToFileURL } from "node:url";
import { selectedPiStoredCredential } from "../../../packages/crew/src/pi-inference.ts";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { type PiEvent } from "@amun/contracts";
import { PiSession } from "./pi-session.ts";
/** Isolated runtime with explicitly selected credential reuse; no personal config, skills or MCPs. */
export async function openPiProtocol(
  binary: string,
  entry: string,
  send: (event: PiEvent) => void,
  provider: "protocol" | "openrouter" | "github-copilot" = "protocol",
  handleBridge: (request: BridgeRequest) => string,
): Promise<PiSession> {
  const root = await mkdtemp(join(tmpdir(), "amun-pi-service-"));
  let bridge: Awaited<ReturnType<typeof openBridge>> | undefined;
  try {
    let bridgeReady = false;
    const bridgeEntry = join(root, "extension.ts");
    for (const [name, source] of [
      ["extension.ts", bridgeSource],
      ["gate.ts", gateSource],
      ["client.ts", clientSource],
    ] as const)
      await writeFile(join(root, name), source, { mode: 0o600, flag: "wx" });
    bridge = await openBridge(async (request) => {
      if (request.op === "event" && request.name === "bridge_ready") {
        bridgeReady = true;
        return "ready";
      }
      return handleBridge(request);
    }, root);
    const config = join(root, "config");
    await mkdir(config, { mode: 0o700 });
    const model =
      provider === "openrouter" ? "openai/gpt-4.1-mini" : "gpt-5.4-nano";
    if (provider !== "protocol") {
      const sdk = (await import(
        pathToFileURL(join(dirname(dirname(entry)), "index.js")).href
      )) as {
        readStoredCredential: (provider: string, path: string) => unknown;
      };
      const credential = selectedPiStoredCredential(
        provider,
        sdk.readStoredCredential(
          provider,
          join(homedir(), ".pi/agent/auth.json"),
        ),
      );
      await writeFile(
        join(config, "auth.json"),
        JSON.stringify({ [provider]: credential }),
        { mode: 0o600, flag: "wx" },
      );
    }
    await writeFile(
      join(config, "settings.json"),
      JSON.stringify({ retry: { enabled: false } }),
      { mode: 0o600, flag: "wx" },
    );
    const cleanupPath = join(root, "cleanup.ts");
    await writeFile(cleanupPath, cleanupExtension(root), {
      mode: 0o600,
      flag: "wx",
    });
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
        ...(provider === "protocol"
          ? ["--offline"]
          : ["--provider", provider, "--model", model]),
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-mcp",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--extension",
        extension,
        "--extension",
        cleanupPath,
        "--extension",
        bridgeEntry,
      ],
      {
        cwd: root,
        env: {
          HOME: root,
          AMUN_BRIDGE_SOCKET: bridge.path,
          AMUN_BRIDGE_TOKEN: bridge.token,
          AMUN_BRIDGE_ENTRY: bridgeEntry,
          PATH: "",
          PI_CODING_AGENT_DIR: config,
          PI_SKIP_VERSION_CHECK: "1",
          ...(provider === "protocol" ? { PI_OFFLINE: "1" } : {}),
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
      void bridge?.close();
      session.close();
      void rm(root, { recursive: true, force: true });
    };
    child.once("exit", cleanup);
    child.once("error", cleanup);
    child.stdin.on("error", () => session.close());
    const timer = setTimeout(() => session.close(), 300000);
    try {
      await session.ready(
        provider === "protocol" ? undefined : { provider, model },
        () => bridgeReady,
      );
    } catch {
      session.close();
      throw new Error("Pi readiness unavailable");
    }
    return session;
  } catch {
    await bridge?.close();
    await rm(root, { recursive: true, force: true });
    throw new Error("Pi runtime unavailable");
  }
}
