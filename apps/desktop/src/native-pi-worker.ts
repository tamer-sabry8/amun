import { pathToFileURL } from "node:url";
import { mkdir, lstat, realpath } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  nativePiCommand,
  nativePiEvent,
} from "../../../packages/contracts/src/native-pi.ts";
import {
  NativePiActions,
  type NativePiSession,
} from "../../../packages/crew/src/native-pi.ts";
import { preparePiAuth } from "../../../packages/auth/src/pi-auth.ts";
import { JsonLineDecoder } from "../../../packages/crew/src/jsonl.ts";
const root = process.env.AMUN_AUTH_ROOT,
  entry = process.env.AMUN_AUTH_SDK;
if (!root || !entry) throw Error("Native Pi configuration unavailable");
let session: (NativePiSession & { dispose(): void }) | undefined;
let actions: NativePiActions | undefined;
let busy = false;
async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700, recursive: true });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    (await realpath(path)) !== path
  )
    throw Error("Unsafe native workspace");
}
async function initialize() {
  const authPath = await preparePiAuth(root!);
  const cwd = join(dirname(root!), "pi-workspace");
  await privateDirectory(cwd);
  const sessions = join(cwd, "sessions");
  await privateDirectory(sessions);
  const sdk = (await import(pathToFileURL(entry!).href)) as {
    ModelRuntime: { create(options: unknown): Promise<unknown> };
    DefaultResourceLoader: new (options: unknown) => {
      reload(): Promise<void>;
    };
    SessionManager: { create(cwd: string, dir: string): unknown };
    createAgentSession(
      options: unknown,
    ): Promise<{ session: NativePiSession & { dispose(): void } }>;
  };
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath,
    modelsPath: null,
    modelsStorePath: join(root!, "models-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir: root,
    noExtensions: true,
    disabledBuiltinExtensions: ["mcp"],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  ({ session } = await sdk.createAgentSession({
    cwd,
    agentDir: root,
    modelRuntime,
    resourceLoader,
    noTools: "all",
    sessionManager: sdk.SessionManager.create(cwd, sessions),
  }));
  actions = new NativePiActions(session);
}
const decoder = new JsonLineDecoder(65536);
const send = (id: string, result: unknown) =>
  process.stdout.write(
    JSON.stringify(
      nativePiEvent.parse({ version: 1, kind: "native-pi-result", id, result }),
    ) + "\n",
  );
function stop() {
  session?.dispose();
  process.exit(0);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  try {
    for (const frame of decoder.push(chunk)) {
      const command = nativePiCommand.parse(frame);
      if (command.action === "close") {
        stop();
        return;
      }
      if (busy) {
        send(command.id, {
          kind: "message",
          text: "A native Pi operation is already running.",
        });
        continue;
      }
      busy = true;
      void (async () => {
        if (!actions) await initialize();
        send(command.id, await actions!.run(command.command, command.argument));
      })()
        .catch(() =>
          send(command.id, {
            kind: "message",
            text: "This native action could not be completed. Check session state and the supported argument.",
          }),
        )
        .finally(() => {
          busy = false;
        });
    }
  } catch {
    stop();
  }
});
process.stdin.on("end", stop);
process.on("SIGTERM", stop);
