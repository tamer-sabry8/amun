import { Redactor } from "../../../packages/security/src/redaction.ts";
import {
  conversationSharePreview,
  registerCredentialSecrets,
} from "../../../packages/security/src/conversation-share.ts";
import { sharingGate } from "../../../packages/domain/src/sharing-policy.ts";
import { nativeDocumentPage } from "../../../packages/crew/src/native-pi-docs.ts";
import { ScopedOperation } from "../../../packages/crew/src/scoped-operation.ts";
import {
  NativePiTrust,
  type TrustStore,
} from "../../../packages/crew/src/native-pi-trust.ts";
import {
  NativePiSettings,
  type SettingsSession,
} from "../../../packages/crew/src/native-pi-settings.ts";
import {
  NativePiExport,
  type ExportSession,
} from "../../../packages/crew/src/native-pi-export.ts";
import {
  NativePiPreferences,
  type PreferenceSession,
} from "../../../packages/crew/src/native-pi-preferences.ts";
import { userInfo } from "node:os";
import { SubscriptionWorker } from "../../../packages/crew/src/subscription-worker.ts";
import {
  NativePiSessions,
  type NativeSessionRuntime,
} from "../../../packages/crew/src/native-pi-sessions.ts";
import { pathToFileURL } from "node:url";
import { mkdir, lstat, realpath, readFile } from "node:fs/promises";
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
type Runtime = NativeSessionRuntime & {
  session: NativePiSession &
    PreferenceSession &
    ExportSession &
    SettingsSession & {
      modelRuntime: { listCredentials(): Promise<{ providerId: string }[]> };
      sessionManager: { getBranch(): unknown[] };
    };
  dispose(): Promise<void>;
};
let runtime: Runtime | undefined;
let sessionActions: NativePiSessions | undefined;
let trustActions: NativePiTrust | undefined;
let changelogPath: string | undefined;
let readCredential: ((provider: string, path: string) => unknown) | undefined;
let privateAuthPath: string | undefined;
let busy = false;
let stopping = false;
const workerOperation = new ScopedOperation();
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
  privateAuthPath = authPath;
  const cwd = join(dirname(root!), "pi-workspace");
  await privateDirectory(cwd);
  const sessions = join(cwd, "sessions");
  await privateDirectory(sessions);
  const sdk = (await import(pathToFileURL(entry!).href)) as {
    ModelRuntime: { create(options: unknown): Promise<unknown> };
    getPackageDir(): string;
    readStoredCredential(provider: string, path: string): unknown;
    ProjectTrustStore: new (root: string) => TrustStore;
    SessionManager: {
      create(cwd: string, dir: string): unknown;
      list(
        cwd: string,
        dir: string,
      ): Promise<{ id: string; name?: string; path: string; cwd: string }[]>;
    };
    createAgentSessionServices(
      options: unknown,
    ): Promise<{ diagnostics: unknown[] }>;
    createAgentSessionFromServices(options: unknown): Promise<unknown>;
    createAgentSessionRuntime(
      factory: (options: {
        cwd: string;
        agentDir: string;
        sessionManager: unknown;
        sessionStartEvent?: unknown;
      }) => Promise<unknown>,
      options: unknown,
    ): Promise<Runtime>;
  };
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath,
    modelsPath: null,
    modelsStorePath: join(root!, "models-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime = await sdk.createAgentSessionRuntime(
    async (options) => {
      if (options.cwd !== cwd || options.agentDir !== root)
        throw Error("Foreign session context");
      const services = await sdk.createAgentSessionServices({
        cwd,
        agentDir: root,
        modelRuntime,
        resourceLoaderOptions: {
          noExtensions: true,
          disabledBuiltinExtensions: ["mcp"],
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });
      const created = await sdk.createAgentSessionFromServices({
        services,
        sessionManager: options.sessionManager,
        sessionStartEvent: options.sessionStartEvent,
        noTools: "all",
      });
      return {
        ...(created as object),
        services,
        diagnostics: services.diagnostics,
      };
    },
    {
      cwd,
      agentDir: root,
      sessionManager: sdk.SessionManager.create(cwd, sessions),
    },
  );
  changelogPath = join(sdk.getPackageDir(), "CHANGELOG.md");
  readCredential = sdk.readStoredCredential;
  trustActions = new NativePiTrust(new sdk.ProjectTrustStore(root!), cwd);
  sessionActions = new NativePiSessions(runtime, cwd, sessions, () =>
    sdk.SessionManager.list(cwd, sessions),
  );
}
const decoder = new JsonLineDecoder(65536);
const send = (id: string, result: unknown) =>
  process.stdout.write(
    JSON.stringify(
      nativePiEvent.parse({ version: 1, kind: "native-pi-result", id, result }),
    ) + "\n",
  );
function stop() {
  if (stopping) return;
  stopping = true;
  process.stdin.pause();
  void Promise.allSettled([
    workerOperation.close(),
    runtime?.dispose() ?? Promise.resolve(),
  ]).finally(() => process.exit(0));
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  if (stopping) return;
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
        if (["worker-status", "worker-inference"].includes(command.command)) {
          if (command.argument !== "codex" && command.argument !== "claude")
            throw Error("Unsupported worker");
          const tool = command.argument;
          const text = await workerOperation.run(async (signal) => {
            const worker = new SubscriptionWorker({
              home: userInfo().homedir,
              binary: process.execPath,
              tool,
              signal,
            });
            return command.command === "worker-status"
              ? worker.status()
              : worker.infer();
          });
          if (!stopping) send(command.id, { kind: "message", text });
          return;
        }
        if (command.command === "share") {
          send(command.id, {
            kind: "message",
            text: sharingGate({
              destination: "pi",
              connected: false,
              parentSelected: false,
              contentHash: "",
            }).reason,
          });
          return;
        }
        if (!runtime) await initialize();
        if (command.command === "share-notion") {
          const redactor = new Redactor();
          const credentials =
            await runtime!.session.modelRuntime.listCredentials();
          if (credentials.length > 100)
            throw Error("Credential catalog too large");
          for (const info of credentials)
            registerCredentialSecrets(
              redactor,
              readCredential!(info.providerId, privateAuthPath!),
            );
          send(
            command.id,
            conversationSharePreview(
              runtime!.session.sessionName ?? "Amun conversation",
              runtime!.session.sessionManager.getBranch(),
              redactor,
            ),
          );
          return;
        }
        if (command.command === "changelog") {
          const info = await lstat(changelogPath!);
          if (!info.isFile() || info.size > 2097152)
            throw Error("Changelog unavailable");
          send(
            command.id,
            nativeDocumentPage(
              await readFile(changelogPath!, "utf8"),
              command.argument,
            ),
          );
          return;
        }
        if (command.command === "hotkeys") {
          send(
            command.id,
            nativeDocumentPage(
              "Native Pi controls currently available:\nCtrl+P — next model while focus is inside Pi commands.\nCtrl+Shift+P — previous model.\nTab / Shift+Tab — move between native controls.\nEnter / Space — activate the focused button.\nCommand+K — Amun command palette.\nOther Pi terminal shortcuts require native equivalents and are not yet available.",
              command.argument,
              "Amun native Pi shortcuts",
            ),
          );
          return;
        }
        if (command.command === "trust") {
          if (runtime!.session.isStreaming)
            throw Error("Wait for the current turn");
          send(command.id, trustActions!.run(command.argument));
          return;
        }
        if (command.command === "settings") {
          send(
            command.id,
            await new NativePiSettings(runtime!.session).run(command.argument),
          );
          return;
        }
        if (command.command === "export") {
          if (!command.argument) {
            send(command.id, {
              kind: "choices",
              title: "Choose export format for review",
              choices: [
                { id: "jsonl", label: "JSONL" },
                { id: "html", label: "HTML" },
              ],
            });
            return;
          }
          send(
            command.id,
            await new NativePiExport(runtime!.session, root!).run(
              command.argument,
            ),
          );
          return;
        }
        if (command.command === "cycle-model") {
          send(
            command.id,
            await new NativePiPreferences(runtime!.session).cycle(
              command.argument,
            ),
          );
          return;
        }
        if (command.command === "scoped-models") {
          send(
            command.id,
            await new NativePiPreferences(runtime!.session).run(
              command.command,
              command.argument,
            ),
          );
          return;
        }
        const result = ["new", "resume", "fork", "clone", "tree"].includes(
          command.command,
        )
          ? await sessionActions!.run(command.command, command.argument)
          : await new NativePiActions(runtime!.session).run(
              command.command,
              command.argument,
            );
        send(command.id, result);
      })()
        .catch(
          () =>
            !stopping &&
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
