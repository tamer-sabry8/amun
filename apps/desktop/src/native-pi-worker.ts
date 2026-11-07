import {
  workspaceFileChoices,
  completeWorkspaceFile,
} from "../../../packages/crew/src/native-workspace-files.ts";
import { ReviewedExtensions } from "../../../packages/crew/src/reviewed-extensions.ts";
import {
  NativeExtensionUI,
  extensionNames,
  type ExtensionSession,
} from "../../../packages/crew/src/native-extension-ui.ts";
import {
  runCaptainShell,
  type ShellResult,
} from "../../../packages/crew/src/native-shell.ts";
import {
  resourceDirectories,
  resourceNames,
  expandResource,
  type ResourceSession,
} from "../../../packages/crew/src/native-pi-resources.ts";
import {
  googleMcpProduct,
  discoverGoogleMcp,
} from "../../../packages/auth/src/google-workspace-mcp.ts";
import { checkBrowserMcp } from "../../../packages/auth/src/browser-mcp.ts";
import { discoverCloudflareDocs } from "../../../packages/auth/src/cloudflare-docs.ts";
import { checkFirstmateCandidate } from "../../../packages/crew/src/firstmate-candidate.ts";
import { nativeMcp } from "../../../packages/crew/src/native-mcp.ts";
import {
  nativeTurn,
  type NativeTurnSession,
} from "../../../packages/crew/src/native-pi-turn.ts";
import { nativeBugReport } from "../../../packages/crew/src/native-pi-bug.ts";
import { nativeConversationView } from "../../../packages/crew/src/native-pi-conversation.ts";
import { NativePiImport } from "../../../packages/crew/src/native-pi-import.ts";
import {
  NativePiCredentials,
  type CredentialSession,
} from "../../../packages/crew/src/native-pi-credentials.ts";
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
  textAttachmentRequest,
  captainShellRequest,
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
  session: ExtensionSession &
    ResourceSession &
    NativeTurnSession & {
      resourceLoader: { getExtensions(): { errors: unknown[] } };
    } & CredentialSession &
    NativePiSession &
    PreferenceSession &
    ExportSession &
    SettingsSession & {
      modelRuntime: { listCredentials(): Promise<{ providerId: string }[]> };
      sessionManager: { getBranch(): unknown[] };
      sessionId: string;
      getActiveToolNames(): string[];
      steer(text: string): Promise<string>;
      followUp(text: string): Promise<string>;
      clearQueue(): { steering: string[]; followUp: string[] };
      getSteeringMessages(): readonly string[];
      getFollowUpMessages(): readonly string[];
      recordBashResult(
        command: string,
        result: ShellResult,
        options: { excludeFromContext: boolean },
      ): void;
    };
  importFromJsonl(
    path: string,
    cwdOverride: string,
  ): Promise<{ cancelled: boolean }>;
  dispose(): Promise<void>;
};
let runtime: Runtime | undefined;
let reviewed: ReviewedExtensions | undefined;
const extensionUI = new NativeExtensionUI();
let expandPiTemplate: Parameters<typeof expandResource>[4];
let stripPiFrontmatter: Parameters<typeof expandResource>[5];
let sessionActions: NativePiSessions | undefined;
let importActions: NativePiImport | undefined;
let trustActions: NativePiTrust | undefined;
let credentialActions: NativePiCredentials | undefined;
let changelogPath: string | undefined;
let piVersion = "unknown";
let readCredential: ((provider: string, path: string) => unknown) | undefined;
let privateAuthPath: string | undefined;
let busy = false;
let activeTurnId: string | undefined;
let queueBusy = false;
const queueRequests = new Set<string>();
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
  reviewed ??= await ReviewedExtensions.open(root!);
  await reviewed.refresh();
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
  const core = dirname(entry!);
  ({ expandPromptTemplate: expandPiTemplate } = await import(
    pathToFileURL(join(core, "core/prompt-templates.js")).href
  ));
  ({ stripFrontmatter: stripPiFrontmatter } = await import(
    pathToFileURL(join(core, "utils/frontmatter.js")).href
  ));
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath,
    modelsPath: null,
    modelsStorePath: join(root!, "models-cache.json"),
    allowModelNetwork: false,
    // Populate the installed catalog and scoped credential availability without network discovery.
    refreshOnCreate: true,
  });
  runtime = await sdk.createAgentSessionRuntime(
    async (options) => {
      if (options.cwd !== cwd || options.agentDir !== root)
        throw Error("Foreign session context");
      const dirs = await resourceDirectories(root!);
      const services = await sdk.createAgentSessionServices({
        cwd,
        agentDir: root,
        modelRuntime,
        resourceLoaderOptions: {
          noExtensions: true,
          additionalExtensionPaths: [reviewed!.entry],
          disabledBuiltinExtensions: ["mcp"],
          additionalSkillPaths: [dirs.skills],
          additionalPromptTemplatePaths: [dirs.prompts],
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
  importActions = new NativePiImport(runtime, cwd, async () =>
    (await sdk.SessionManager.list(cwd, sessions)).map((session) => session.id),
  );
  credentialActions = new NativePiCredentials(runtime.session);
  changelogPath = join(sdk.getPackageDir(), "CHANGELOG.md");
  const packagePath = join(sdk.getPackageDir(), "package.json");
  if ((await lstat(packagePath)).size > 65536)
    throw Error("Runtime metadata too large");
  const packageInfo = JSON.parse(await readFile(packagePath, "utf8")) as {
    version?: unknown;
  };
  if (
    typeof packageInfo.version !== "string" ||
    packageInfo.version.length > 128
  )
    throw Error("Runtime version unavailable");
  piVersion = packageInfo.version;
  readCredential = sdk.readStoredCredential;
  trustActions = new NativePiTrust(new sdk.ProjectTrustStore(root!), cwd);
  sessionActions = new NativePiSessions(runtime, cwd, sessions, () =>
    sdk.SessionManager.list(cwd, sessions),
  );
}
const decoder = new JsonLineDecoder(4194304);
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
  extensionUI.close();
  void Promise.allSettled([
    workerOperation.close(),
    runtime?.dispose() ?? Promise.resolve(),
  ]).finally(async () => {
    await reviewed?.close();
    process.exit(0);
  });
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  if (stopping) return;
  try {
    for (const frame of decoder.push(chunk)) {
      const command = nativePiCommand.parse(frame);
      if (command.action === "queue-input") {
        const s = runtime?.session;
        const report = (status: string, accepted = false, recalled?: string) =>
          activeTurnId === command.id &&
          send(command.id, {
            kind: "turn-queue",
            sequence: command.sequence,
            status,
            accepted,
            ...(recalled === undefined ? {} : { recalled }),
          });
        if (!s || command.id !== activeTurnId) continue;
        if (
          !s.isStreaming ||
          s.sessionId !== command.sessionId ||
          queueBusy ||
          queueRequests.size >= 64 ||
          queueRequests.has(command.sequence)
        ) {
          report("Queue request unavailable.");
          continue;
        }
        queueBusy = true;
        queueRequests.add(command.sequence);
        void (async () => {
          const existing = [
            ...s.getSteeringMessages(),
            ...s.getFollowUpMessages(),
          ];
          if (command.mode === "recall") {
            if (command.text || existing.join("\n\n").length > 12000)
              throw Error();
            const recalled = s.clearQueue();
            report(
              "Queue recalled.",
              true,
              [...recalled.steering, ...recalled.followUp].join("\n\n"),
            );
            return;
          }
          if (
            !command.text.trim() ||
            /^[!\/]/.test(command.text.trimStart()) ||
            command.text.includes("\0") ||
            existing.length >= 16 ||
            [...existing, command.text].join("\n\n").length > 12000
          )
            throw Error();
          const result = await (command.mode === "steer"
            ? s.steer(command.text)
            : s.followUp(command.text));
          if (result !== "queued") throw Error();
          report(
            command.mode === "steer"
              ? "Steering message queued"
              : "Follow-up queued",
            true,
          );
        })()
          .catch(() => report("Queue request could not be verified."))
          .finally(() => {
            queueBusy = false;
          });
        continue;
      }
      if (command.action === "answer-extension") {
        extensionUI.answer(command.id, command.dialog, command.answer);
        continue;
      }
      if (command.action === "abort-turn") {
        if (activeTurnId === command.id)
          void runtime?.session.abort().catch(() => {});
        continue;
      }
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
        if (command.command === "updatefirstmate") {
          const text = await checkFirstmateCandidate(command.argument).catch(
            () =>
              command.argument.trim()
                ? "Run /updatefirstmate without arguments to check the candidate."
                : "Could not verify Firstmate’s upstream main. Check the network connection.",
          );
          send(command.id, { kind: "message", text });
          return;
        }
        if (command.command === "mcp") {
          if (
            command.argument === "playwright" ||
            command.argument === "chrome" ||
            command.argument === "puppeteer"
          ) {
            if (!process.env.AMUN_MCP_MODULES)
              throw Error("Browser adapter runtime missing");
            const text = await checkBrowserMcp(
              command.argument,
              process.env.AMUN_MCP_MODULES,
            ).catch(
              () =>
                "Browser check failed. Verify Google Chrome is installed and retry.",
            );
            send(command.id, { kind: "message", text });
            return;
          }
          const google = googleMcpProduct(command.argument);
          if (google) {
            send(command.id, {
              kind: "message",
              text: await discoverGoogleMcp(google),
            });
            return;
          }
          send(
            command.id,
            command.argument === "cloudflare"
              ? { kind: "message", text: await discoverCloudflareDocs() }
              : await nativeMcp(command.argument),
          );
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
        if (command.command.startsWith("extension-") && !reviewed) {
          await privateDirectory(root!);
          reviewed = await ReviewedExtensions.open(root!);
        }
        if (command.command === "extension-review") {
          const { name, source } = JSON.parse(command.argument);
          send(command.id, reviewed!.review(name, source));
          return;
        }
        if (
          command.command === "extension-install" ||
          command.command === "extension-remove"
        ) {
          if (command.command === "extension-install")
            await reviewed!.trust(command.argument);
          else await reviewed!.remove(command.argument);
          if (runtime) await runtime.session.reload();
          else if (command.command === "extension-install") await initialize();
          if (
            command.command === "extension-install" &&
            runtime?.session.resourceLoader.getExtensions().errors.length
          ) {
            send(command.id, {
              kind: "message",
              text: "Reviewed extension saved, but Pi reported a loading error. Remove it in Manage trusted extensions.",
            });
            return;
          }
          send(command.id, {
            kind: "message",
            text:
              command.command === "extension-install"
                ? "Extension installed."
                : "Extension removed.",
          });
          return;
        }
        if (command.command === "extension-list") {
          send(command.id, {
            kind: "choices",
            title: "Remove an installed extension by its reviewed SHA-256",
            choices: (await reviewed!.installed()).map((id) => ({
              id,
              label: id,
            })),
          });
          return;
        }
        if (!runtime) await initialize();
        if (command.command === "reload") {
          await resourceDirectories(root!);
          await reviewed!.refresh();
        }
        if (command.command === "conversation-send") {
          if (runtime!.session.getActiveToolNames().length)
            throw Error("Native model turn has unexpected tools");
          queueRequests.clear();
          activeTurnId = command.id;
          try {
            const outcome = await nativeTurn(
              runtime!.session,
              JSON.parse(command.argument),
            );
            if (outcome === "aborted") {
              send(command.id, {
                kind: "message",
                text: "Turn stopped. Read the conversation to see any partial reply.",
              });
              return;
            }
          } finally {
            activeTurnId = undefined;
          }
        }
        if (command.command === "import-preview") {
          send(command.id, importActions!.preview(command.argument));
          return;
        }
        if (command.command === "import") {
          send(command.id, await importActions!.confirm(command.argument));
          return;
        }
        if (command.command === "logout") {
          send(command.id, await credentialActions!.run(command.argument));
          return;
        }
        if (
          [
            "share-notion",
            "conversation",
            "conversation-send",
            "resource-draft",
            "attach-text",
            "file-complete",
            "file-attach",
            "captain-shell",
            "extension-command",
            "bug",
            "debug",
          ].includes(command.command)
        ) {
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
          if (command.command === "extension-command") {
            const i = JSON.parse(command.argument),
              s = runtime!.session;
            if (
              s.sessionId !== i.sessionId ||
              s.isStreaming ||
              typeof i.argument !== "string"
            )
              throw Error("Session changed");
            const text = await extensionUI.run(
              s,
              command.id,
              i.name,
              i.argument,
              (dialog) => send(command.id, dialog),
              (t) => redactor.text(t),
            );
            send(command.id, { kind: "message", text });
            return;
          }
          if (command.command === "captain-shell") {
            const input = captainShellRequest.parse(
              JSON.parse(command.argument),
            );
            const session = runtime!.session;
            if (session.isStreaming || input.sessionId !== session.sessionId)
              throw Error("Shell session changed");
            const cwd = join(dirname(root!), "pi-workspace");
            await privateDirectory(cwd);
            const shell = await workerOperation.run((signal) =>
              runCaptainShell(input.command, cwd, signal),
            );
            shell.output = redactor.text(shell.output);
            session.recordBashResult(redactor.text(input.command), shell, {
              excludeFromContext: input.excludeFromContext,
            });
            send(command.id, {
              kind: "message",
              text: [
                input.excludeFromContext
                  ? "Excluded from Pi model context"
                  : "Included in Pi model context",
                shell.cancelled
                  ? "Command stopped"
                  : "Exit " + (shell.exitCode ?? "unknown"),
                shell.output,
                shell.truncated ? "Output truncated at 64 KiB." : "",
              ]
                .filter(Boolean)
                .join("\n"),
            });
            return;
          }
          if (command.command === "bug") {
            const model = runtime!.session.model;
            send(
              command.id,
              nativeBugReport(
                {
                  sessionId: runtime!.session.sessionId,
                  hint: command.argument,
                  piVersion,
                  platform: process.platform,
                  model: model
                    ? model.provider + "/" + model.id
                    : "No model selected",
                },
                redactor,
              ),
            );
            return;
          }
          if (command.command === "share-notion") {
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
          const session = runtime!.session;
          const view = nativeConversationView(
            session.sessionId,
            session.sessionName ?? "Unnamed conversation",
            session.sessionManager.getBranch(),
            redactor,
            session.model
              ? session.model.provider + "/" + session.model.id
              : null,
          );
          if (command.command === "debug") {
            if (command.argument.trim())
              throw Error("Unexpected debug argument");
            const text =
              JSON.stringify({
                type: "amun-native-pi-debug",
                schemaVersion: 1,
                piVersion,
                sessionId: view.sessionId,
                model: view.model && redactor.text(view.model),
                streaming: session.isStreaming,
                title: view.title,
                omittedItems: view.omittedItems,
                transcript: view.text,
              }) + "\n";
            if (Buffer.byteLength(text) > 524288)
              throw Error("Diagnostic exceeds review limit");
            send(command.id, {
              kind: "export",
              format: "jsonl",
              text,
              review: text,
            });
            return;
          }
          let resourceDraft: string | undefined;
          if (
            command.command === "file-complete" ||
            command.command === "file-attach"
          ) {
            const input = JSON.parse(command.argument);
            if (
              input.sessionId !== session.sessionId ||
              session.isStreaming ||
              typeof input.draft !== "string" ||
              input.draft.length > 12000
            )
              throw Error("Session changed");
            const rootDir = join(dirname(root!), "pi-workspace");
            if (command.command === "file-complete") {
              send(command.id, {
                ...view,
                resources: resourceNames(session),
                extensionCommands: extensionNames(session),
                fileOptions: await workspaceFileChoices(rootDir, input.draft),
              });
              return;
            }
            resourceDraft = redactor.text(
              await completeWorkspaceFile(rootDir, input.draft, input.pick),
            );
          }
          if (command.command === "attach-text") {
            const input = textAttachmentRequest.parse(
              JSON.parse(command.argument),
            );
            if (input.sessionId !== session.sessionId || session.isStreaming)
              throw Error("Attachment session changed");
            const prefix = input.draft.replace(/(^|\s)@$/, "$1").trimEnd();
            resourceDraft = redactor.text(
              [prefix, "Attached file: " + input.name + "\n" + input.content]
                .filter(Boolean)
                .join("\n\n"),
            );
            if (resourceDraft.length > 12000)
              throw Error("Attachment exceeds conversation draft limit");
          }
          if (command.command === "resource-draft") {
            const input = JSON.parse(command.argument);
            if (
              input?.sessionId !== session.sessionId ||
              typeof input.name !== "string" ||
              typeof input.argument !== "string" ||
              session.isStreaming
            )
              throw Error("Resource session changed");
            resourceDraft = redactor.text(
              await expandResource(
                session,
                root!,
                input.name,
                input.argument,
                expandPiTemplate,
                stripPiFrontmatter,
              ),
            );
          }
          send(command.id, {
            ...view,
            resources: resourceNames(session),
            extensionCommands: extensionNames(session),
            acceptsImage:
              !session.settingsManager.getBlockImages() &&
              !!session.model?.input?.includes("image"),
            ...(resourceDraft === undefined ? {} : { resourceDraft }),
          });
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
              "Native Pi controls currently available:\nCtrl+L — select a model.\nCtrl+P — next model while focus is inside Pi commands.\nCtrl+Shift+P — previous model.\nTab / Shift+Tab — move between native controls.\nEnter — submit a conversation draft. Shift+Enter or Control+J — insert a line. During a response, Enter steers, Alt+Enter queues a follow-up, Alt+Up recalls the queue, and Escape stops the response. In the message field, Shift+Tab cycles thinking and Control+Z parks Pi controls with the draft saved in this window. Control+G opens the multiline draft editor. Control+O shows tool output and Control+T shows available provider summaries when Calm is off. Tab at an @reference completes a workspace path. Paste an image to review it before sending. Control+C clears an unselected draft. Control+D closes an empty composer. Enter / Space activates the focused button.\nCommand+K — Amun command palette.\nOther Pi terminal shortcuts require native equivalents and are not yet available.",
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
              text:
                command.command === "conversation-send"
                  ? "Turn outcome could not be verified. Read the conversation before sending another message."
                  : "This native action could not be completed. Check session state and the supported argument.",
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
