import { updateCommand } from "../../../packages/contracts/src/stakeholder.ts";
import { StakeholderUpdates } from "../../../packages/data/src/stakeholder.ts";
import { writeStakeholderPdf } from "./stakeholder-pdf.ts";
import { syncCommand } from "../../../packages/contracts/src/memory-sync.ts";
import { PrototypeSession } from "./prototype-session.ts";
import { prototypeCommand } from "../../../packages/contracts/src/prototype.ts";
import { implementationRun } from "./implementation-run.ts";
import { sendDelivery } from "../../../packages/crew/src/send-delivery.ts";
import { deliveryCommand } from "../../../packages/contracts/src/crew.ts";
import { readPullWorkspace } from "./pr-workspace.ts";
import { prCommand } from "../../../packages/contracts/src/pr-workspace.ts";
import { ChatSession } from "./firstmate-chat.ts";
import { FirstmateChat } from "../../../packages/data/src/firstmate-chat.ts";
import { runAdoOperation } from "./ado-operations.ts";
import { AdoWriteClient } from "../../../packages/connectors-ado/src/governed-writes.ts";
import {
  adoOperation,
  backlogRead,
} from "../../../packages/contracts/src/backlog.ts";
import { projectSource } from "../../../packages/connectors-ado/src/project-source.ts";
import { BoardDiscovery } from "../../../packages/connectors-ado/src/board-discovery.ts";
import { azureTransport } from "../../../packages/connectors-ado/src/transport.ts";
import { localStow } from "../../../packages/crew/src/firstmate-stow.ts";
import { BoardError } from "../../../packages/crew/src/firstmate-board.ts";
import { FirstmateSupervision } from "../../service/src/firstmate-supervision.ts";
import { FirstmateModelPicker } from "../../service/src/firstmate-model-picker.ts";
import {
  crewCalmEnabled,
  toggleFirstmateCalm,
} from "../../service/src/firstmate-calm.ts";
import { firstmateBearings } from "../../../packages/crew/src/firstmate-bearings.ts";
import { dispatchFirstmate } from "../../../packages/crew/src/firstmate-dispatch.ts";
import { FirstmateReleases } from "../../../packages/crew/src/firstmate-release.ts";
import { handleBridgeRequest } from "../../../packages/data/src/pi-bridge.ts";
import { crewProfile } from "../../../packages/crew/src/crew-profile.ts";
import { readCrewBearings } from "../../../packages/crew/src/firstmate-bearings.ts";
import { crewList } from "../../../packages/contracts/src/crew.ts";
import { listReceiptTasks } from "../../../packages/crew/src/endpoint-receipt.ts";
import {
  readHosting,
  saveHosting,
} from "../../../packages/data/src/hosting-destination.ts";
import {
  cloudflareConsentArgs,
  inspectCloudflareHosting,
} from "../../../packages/auth/src/cloudflare-hosting.ts";
import {
  GithubDeviceLogin,
  githubDevicePost,
  githubGrant,
} from "../../../packages/auth/src/github-device.ts";
import {
  GithubReadFailure,
  checkGithubMcp,
  createGithubIssue,
} from "../../../packages/auth/src/github-mcp.ts";
import { GithubIssueReview } from "../../../packages/data/src/github-issue.ts";
import { createHash } from "node:crypto";
import { NotionConversationReview } from "../../../packages/data/src/notion-review.ts";
import {
  nativePiCommand,
  nativePiEvent,
  notionApprovalRequest,
  type NativePiEvent,
} from "../../../packages/contracts/src/native-pi.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  NotionConnection,
  notionBrowserArgs,
} from "../../../packages/auth/src/notion-connection.ts";
import { authCommand } from "../../../packages/contracts/src/auth.ts";
import { NativePiProcess } from "../../service/src/native-pi-process.ts";
import {
  exportWorkspace,
  restoreWorkspace,
} from "../../../packages/data/src/backup.ts";
import { backupRequest } from "./backup-policy.ts";
import { checkPiReadiness } from "../../../packages/auth/src/readiness.ts";
import { WorkspaceService } from "../../../packages/data/src/workspace-service.ts";
import { WorkStore } from "../../../packages/data/src/work-store.ts";
import { CouncilService } from "../../../packages/council/src/service.ts";
import { gitFetcher } from "../../../packages/council/src/git-fetcher.ts";
import { Room } from "../../../packages/council/src/room.ts";
import { readFileSync } from "node:fs";
import { councilCommand } from "../../../packages/contracts/src/work.ts";
import { spawn as spawnProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { workspaceIdentity } from "../../../packages/data/src/identity.ts";
import {
  AuthBroker,
  connectionId,
  type Connection,
} from "../../../packages/auth/src/broker.ts";
import {
  macKeyring,
  type EntryLike,
} from "../../../packages/auth/src/keyring.ts";
import { probeConnection } from "../../../packages/auth/src/probe.ts";
import { AuthSession } from "../../../packages/auth/src/session.ts";
import { connectionSchema } from "../../../packages/contracts/src/auth.ts";
import { startPiLogin } from "../../service/src/auth-process.ts";
import { SafeOutputs } from "../../../packages/data/src/audit.ts";
import {
  Redactor,
  createSafeLogger,
} from "../../../packages/security/src/redaction.ts";
import { ActionStore } from "../../../packages/data/src/outbox.ts";
import type Database from "better-sqlite3";
import { openWorkspace } from "../../../packages/data/src/workspace.ts";
import { observeCandidate } from "../../../packages/crew/src/herdr-candidate.ts";
import { CrewObserver } from "../../service/src/crew-observer.ts";
import { observeOwnedTmux } from "../../../packages/crew/src/observe-owned-tmux.ts";
import { openBackendTerminal } from "../../service/src/backend-terminal.ts";
import { backendTerminalOpen } from "../../../packages/contracts/src/terminal.ts";
import { piOpen } from "../../../packages/contracts/src/index.ts";
import { openPiProtocol } from "../../service/src/pi-runtime.ts";
import { type PiSession } from "../../service/src/pi-session.ts";
import { handleHealthRequest } from "../../service/src/health.js";
import { TerminalSession, type Pty } from "../../service/src/terminal.js";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const requireNative = createRequire(join(process.cwd(), "amun-native.cjs"));
const databaseModule = process.env.AMUN_DATABASE_MODULE;
const workspaceRoot = process.env.AMUN_WORKSPACE_ROOT;
if (!databaseModule || !workspaceRoot)
  throw new Error("Workspace runtime unavailable");
const workspace = openWorkspace(
  workspaceRoot,
  requireNative(databaseModule) as typeof Database,
);
const redactor = new Redactor();
const logger = createSafeLogger(redactor, process.stdout);
const outputs = new SafeOutputs(workspace, redactor, logger);
outputs.audit("system", "service.started", "workspace", {});
let syncingMemory = false;
const workspaceService = new WorkspaceService(workspace, redactor);
// UX rebuild model: groups, work areas, records, plans, RFPs (migration 29).
const workStore = new WorkStore(workspace, redactor);
/** The Roast Room version staged with this build (scripts/stage-roast-room.ts). */
function councilPin() {
  const directory = process.env.AMUN_COUNCIL_VENDOR;
  if (!directory) return null;
  try {
    const pin = JSON.parse(readFileSync(join(directory, "pin.json"), "utf8"));
    if (
      typeof pin.repository !== "string" ||
      !/^[a-f0-9]{40}$/.test(pin.commit) ||
      !/^[a-f0-9]{64}$/.test(pin.sha256)
    )
      return null;
    return { directory: join(directory, pin.commit), pin };
  } catch {
    return null;
  }
}
// Council (Roast Room): runs on the Mac's own Claude Code; questions from the
// Chair reach the Island through an Amun-owned tool, never a terminal prompt.
const councilService = new CouncilService({
  root:
    process.env.AMUN_COUNCIL_ROOT ?? join(workspaceRoot ?? "", "roast-room"),
  records: workStore,
  findClaude: async () => {
    for (const candidate of [
      join(homedir(), ".local/bin/claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ])
      if (existsSync(candidate)) return candidate;
    return null;
  },
  spawn: ({ command, args, cwd, stdin }) => {
    const child = spawnProcess(command, args, {
      cwd,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.stdin.end(stdin);
    return {
      done: new Promise((resolve) => {
        child.once("error", () => resolve(1));
        child.once("exit", (code) => resolve(code ?? 1));
      }),
      stop: () => child.kill(),
    };
  },
  askServer: {
    command: process.execPath,
    args: [process.env.AMUN_COUNCIL_ASK ?? ""],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  },
  fetcher: gitFetcher,
  bundledNode: process.versions.node,
  room: (() => {
    let room: Room | null = null;
    return {
      start: (directory: string) => {
        room?.stop();
        room = new Room(directory, {
          node: process.execPath,
          env: { ELECTRON_RUN_AS_NODE: "1" },
        });
        return room.start();
      },
      stop: () => {
        room?.stop();
        room = null;
      },
    };
  })(),
  shipped: councilPin(),
});
setInterval(
  () => void councilService.poll().catch(() => undefined),
  1500,
).unref();
// Weekly, validated, automatic; the previous version is kept for rollback.
setTimeout(
  () => void councilService.checkUpdate().catch(() => undefined),
  60_000,
).unref();
setInterval(
  () => void councilService.checkUpdate().catch(() => undefined),
  6 * 3_600_000,
).unref();
const chats = new FirstmateChat(workspace);
chats.recover();
const actions = new ActionStore(workspace);
actions.recover();
const authKeyring = () => {
  const modulePath = process.env.AMUN_AUTH_MODULE;
  if (!modulePath) throw Error("Auth runtime unavailable");
  const native = requireNative(modulePath) as {
    Entry: new (service: string, account: string) => EntryLike;
  };
  return macKeyring(native.Entry);
};
const authBroker = new AuthBroker(
  workspaceIdentity(workspace),
  {
    get: (account) => authKeyring().get(account),
    set: (account, value) => authKeyring().set(account, value),
    delete: (account) => authKeyring().delete(account),
  },
  redactor,
  probeConnection,
);
let cloudflareBusy = false;
const notionConnection = new NotionConnection({
  workspace: workspaceIdentity(workspace),
  root: workspaceRoot,
  keyring: {
    get: (account) => authKeyring().get(account),
    set: (account, value) => authKeyring().set(account, value),
    delete: (account) => authKeyring().delete(account),
  },
  registerSecret: (value) => redactor.register(value),
  open: async (browser, url) => {
    await promisify(execFile)(
      "/usr/bin/open",
      notionBrowserArgs(browser, url),
      { timeout: 10000 },
    );
  },
});
const authMetadata = {
  list: (): Connection[] => {
    const row = workspace
      .prepare(
        "SELECT value_json FROM workspace_settings WHERE id='connections'",
      )
      .get() as { value_json: string } | undefined;
    const parsed: unknown = row ? JSON.parse(row.value_json) : [];
    if (!Array.isArray(parsed) || parsed.length > 100)
      throw Error("Invalid connections");
    return parsed.map((value) => connectionSchema.parse(value));
  },
  save: (connection: Connection) => {
    const values = authMetadata
      .list()
      .filter((value) => connectionId(value) !== connectionId(connection));
    values.push(connection);
    workspace
      .prepare(
        "INSERT INTO workspace_settings(id,value_json) VALUES ('connections',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
      )
      .run(JSON.stringify(values));
  },
  remove: (connection: Connection) => {
    const values = authMetadata
      .list()
      .filter((value) => connectionId(value) !== connectionId(connection));
    workspace
      .prepare(
        "UPDATE workspace_settings SET value_json=? WHERE id='connections'",
      )
      .run(JSON.stringify(values));
  },
};
const authSessions = new Set<AuthSession>();
const sessions = new Set<TerminalSession>();
const supervisors = new Set<FirstmateSupervision>();
let stopping = false;
let crewDispatchBusy = false;
let togglingCalm = false;
let backupBusy = false;
const reminderListeners = new Set<() => void>();
function checkReminders(missed: boolean) {
  if (workspaceService.reminders.deliver(Date.now(), missed))
    for (const refresh of reminderListeners) refresh();
}
checkReminders(true);
setInterval(() => checkReminders(false), 1000).unref();
process.parentPort?.on("message", (event) => {
  if (event.data?.kind === "resume-reminders") {
    checkReminders(true);
    return;
  }
  if (event.data?.kind === "pause-before-quit") {
    stopping = true;
    void Promise.all([...supervisors].map((s) => s.close())).then(() =>
      process.parentPort?.postMessage({ kind: "primary-paused" }),
    );
    return;
  }
  if (stopping) return;
  if (event.data?.kind === "backup") {
    const job = event.data;
    const request = backupRequest({
      action: job.action,
      password: job.password,
    });
    if (
      !request ||
      typeof job.id !== "string" ||
      typeof job.archive !== "string" ||
      typeof job.target !== "string" ||
      backupBusy
    )
      return;
    backupBusy = true;
    void (async () => {
      let ok = false;
      try {
        if (request.action === "export")
          await exportWorkspace(
            workspace,
            workspaceRoot!,
            job.archive,
            request.password,
            redactor,
          );
        else
          await restoreWorkspace(
            job.archive,
            job.target,
            request.password,
            requireNative(databaseModule!) as typeof Database,
          );
        ok = true;
        outputs.audit(
          "pm",
          request.action === "export" ? "backup.exported" : "backup.restored",
          "workspace",
          {},
        );
      } catch {
        /* No raw paths or passphrase errors cross IPC. */
      } finally {
        request.password = "";
        job.password = "";
        backupBusy = false;
        process.parentPort?.postMessage({
          kind: "backup-result",
          id: job.id,
          ok,
        });
      }
    })();
    return;
  }

  const port = event.ports[0];
  if (!port) return;
  const refreshReminders = () => port.postMessage(workspaceService.snapshot());
  reminderListeners.add(refreshReminders);
  port.once("close", () => reminderListeners.delete(refreshReminders));
  let notionPreview: { title: string; text: string; at: number } | undefined;
  let notionReviewBusy = false;
  const notionReviews = new NotionConversationReview(workspace, {
    marksSendBoundary: true,
    create: async (input, context) => {
      const row = workspace
        .prepare(
          "SELECT value_json FROM workspace_settings WHERE id='notion.destination'",
        )
        .get() as { value_json: string } | undefined;
      if (!row) throw Error("Notion destination missing");
      const target = await notionConnection.inspectTarget(
        JSON.parse(row.value_json) as string,
      );
      if (
        (input.markerPropertyId && !target.markerPropertyAvailable) ||
        target.parentId !== input.parentId ||
        target.parentType !== input.parentType ||
        target.titleProperty !== input.titleProperty
      )
        throw Error("Destination changed; review again");
      return notionConnection.publish(
        input,
        context.workspaceId,
        context.beforeSend,
      );
    },
  });
  let updateReview:
    | {
        id: string;
        binding: string;
        title: string;
        text: string;
        product: string | null;
        channel: string;
      }
    | undefined;
  let updatingStakeholder = false;
  const lookupPublication = notionConnection.locate.bind(notionConnection);
  let checkingReceipt = false;
  const timer = setInterval(() => {
    if (checkingReceipt || notionReviewBusy) return;
    const id = notionReviews.nextCheck();
    if (!id) return;
    checkingReceipt = true;
    void notionReviews
      .check(id, lookupPublication)
      .catch(() => undefined)
      .finally(() => {
        checkingReceipt = false;
      });
  }, 30000);
  port.once("close", () => clearInterval(timer));
  const sendNative = (id: string, result: NativePiEvent["result"]) =>
    port.postMessage(
      nativePiEvent.parse({ version: 1, kind: "native-pi-result", id, result }),
    );
  const githubAccount =
    workspaceIdentity(workspace) +
    "/" +
    connectionId({ kind: "github", baseUrl: "https://api.githubcopilot.com" });
  const githubLogin = new GithubDeviceLogin(
    githubDevicePost,
    async () => {
      await promisify(execFile)(
        "/usr/bin/open",
        ["-a", "Microsoft Edge", "https://github.com/login/device"],
        { timeout: 10000 },
      );
    },
    (grant) => {
      redactor.register(grant.access_token);
      if (grant.refresh_token) redactor.register(grant.refresh_token);
      authKeyring().set(
        githubAccount,
        JSON.stringify({ grant, savedAt: Date.now() }),
      );
    },
  );
  const supervisor = new FirstmateSupervision(
    workspaceRoot!,
    process.env.AMUN_FIRSTMATE_ARCHIVES!,
    process.env.AMUN_PI_BINARY!,
    process.env.AMUN_PI_ENTRY!,
    process.env.AMUN_AUTH_ROOT!,
    redactor,
  );
  supervisors.add(supervisor);
  void supervisor.resume();
  port.once("close", () => {
    void supervisor.close().then(() => supervisors.delete(supervisor));
  });
  const branchPicker = new FirstmateModelPicker();
  port.once("close", () => branchPicker.close());
  const ahoyPending = new Set<string>();
  const nativePi = new NativePiProcess(
    {
      binary: process.env.AMUN_PI_BINARY!,
      worker: process.env.AMUN_NATIVE_PI_WORKER!,
      mcpModules: process.env.AMUN_MCP_MODULES!,
      entry: process.env.AMUN_PI_ENTRY!,
      root: process.env.AMUN_AUTH_ROOT!,
    },
    (event) => {
      if (event.result.kind === "stow-history-status") {
        const { messages, action } = event.result;
        void FirstmateReleases.open(
          workspaceRoot!,
          process.env.AMUN_FIRSTMATE_ARCHIVES!,
        )
          .then((r) => localStow(r, messages, action))
          .then((result) =>
            sendNative(
              event.id,
              typeof result === "string"
                ? { kind: "message", text: redactor.text(result) }
                : {
                    ...result,
                    pins: result.pins.map((pin) => ({
                      ...pin,
                      previous: redactor.text(pin.previous),
                      proposed: redactor.text(pin.proposed),
                    })),
                  },
            ),
          )
          .catch(() =>
            sendNative(event.id, {
              kind: "message",
              text: "Stow could not verify the local home, inventory or memory budget.",
            }),
          );
        return;
      }
      if (
        ahoyPending.delete(event.id) &&
        event.result.kind === "first-captain-message"
      ) {
        void FirstmateReleases.open(
          workspaceRoot!,
          process.env.AMUN_FIRSTMATE_ARCHIVES!,
        )
          .then((r) => firstmateBearings(r, "", redactor))
          .then((digest) => {
            if (typeof digest !== "string") throw Error("Invalid digest");
            sendNative(event.id, { kind: "message", text: digest });
          })
          .catch(() =>
            sendNative(event.id, {
              kind: "message",
              text: "Initial Bearings is unavailable. If away posture is active, run /afk return and resolve the return briefing first.",
            }),
          );
        return;
      }
      if (event.result.kind === "notion-preview") {
        notionPreview = {
          title: redactor.text(event.result.title),
          text: redactor.text(event.result.text),
          at: Date.now(),
        };
      }
      if (event.result.kind === "notion-preview" && notionPreview) {
        port.postMessage({
          ...event,
          result: {
            ...event.result,
            title: notionPreview.title,
            text: notionPreview.text,
            contentHash: createHash("sha256")
              .update(JSON.stringify([notionPreview.title, notionPreview.text]))
              .digest("hex"),
          },
        });
      } else if (event.result.kind === "conversation") {
        const conversation = event.result;
        void crewCalmEnabled(
          workspaceRoot!,
          process.env.AMUN_FIRSTMATE_ARCHIVES!,
        )
          .then((calm) =>
            port.postMessage({
              ...event,
              result: {
                ...conversation,
                calm,
                title: redactor.text(conversation.title),
                text: redactor.text(conversation.text),
              },
            }),
          )
          .catch(() => {
            /* The window closed during the preference read. */
          });
      } else port.postMessage(event);
    },
  );
  nativePi.selectProduct(workspaceService.snapshot().preferences.productId);
  const auth = new AuthSession(
    authBroker,
    authMetadata,
    (event) => port.postMessage(event),
    startPiLogin(
      process.env.AMUN_PI_BINARY!,
      process.env.AMUN_AUTH_WORKER!,
      process.env.AMUN_PI_ENTRY!,
      process.env.AMUN_AUTH_ROOT!,
      (provider, url, selectedHost) =>
        process.parentPort?.postMessage({
          kind: "auth-browser",
          selectedHost,
          provider,
          url,
        }),
    ),
    (provider) =>
      checkPiReadiness(
        process.env.AMUN_PI_BINARY!,
        process.env.AMUN_PI_ENTRY!,
        process.env.AMUN_AUTH_ROOT!,
        provider,
      ),
  );
  authSessions.add(auth);
  let home: string | undefined;
  let pi: PiSession | undefined;
  let opening = false;
  let closed = false;
  const repositoryCredential = (kind: "ado" | "github", url: string) => {
    const conn = authMetadata
      .list()
      .find(
        (c) =>
          c.kind === kind &&
          new URL(c.baseUrl).href.replace(/\/$/, "") ===
            new URL(url).href.replace(/\/$/, ""),
      );
    if (conn) {
      const secret = authKeyring().get(
        workspaceIdentity(workspace) + "/" + connectionId(conn),
      );
      if (secret) {
        redactor.register(secret);
        return secret;
      }
    }
    if (kind === "github" && url === "https://github.com") {
      const stored = JSON.parse(authKeyring().get(githubAccount) ?? "null");
      const grant = githubGrant.parse(stored?.grant);
      if (
        grant.expires_in &&
        Date.now() >= stored.savedAt + grant.expires_in * 1000
      )
        throw Error("GitHub connection expired.");
      return grant.access_token;
    }
    throw Error("Connect the mapped repository host in Settings.");
  };
  const prototypes = new PrototypeSession(
    workspace,
    workspaceRoot!,
    () => (closed ? null : workspaceService.snapshot().preferences.productId),
    async (id, text) => {
      const releases = await FirstmateReleases.open(
        workspaceRoot!,
        process.env.AMUN_FIRSTMATE_ARCHIVES!,
      );
      await supervisor.ensureRunning();
      return sendDelivery(
        releases,
        process.env.AMUN_CREW_RECEIPTS!,
        process.env.AMUN_TMUX_BINARY!,
        "claude",
        id,
        text,
      );
    },
  );
  port.once("close", () => void prototypes.close());
  const chatSession = new ChatSession(
    chats,
    supervisor,
    () => (closed ? null : workspaceService.snapshot().preferences.productId),
    (event) => port.postMessage(event),
  );
  let backendOpening = false;
  let backendEpoch = 0;
  const localTerminal = new TerminalSession(
    () => {
      const modulePath = process.env.AMUN_TERMINAL_MODULE;
      if (!modulePath) throw new Error("Terminal runtime unavailable");
      const native = requireNative(modulePath) as {
        spawn: (file: string, args: string[], options: unknown) => Pty;
      };
      home ??= mkdtempSync(join(tmpdir(), "amun-terminal-"));
      return native.spawn("/bin/bash", ["--noprofile", "--norc"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: home,
        env: {
          HOME: home,
          PATH: "/usr/bin:/bin",
          TERM: "xterm-256color",
          LANG: "en_US.UTF-8",
          PS1: "amun-proof$ ",
        },
      });
    },
    (message) => port.postMessage(message),
  );
  let terminal = localTerminal;
  sessions.add(terminal);
  let listingCrew = false;
  const crew = new CrewObserver(
    async (id) => {
      if (process.env.AMUN_CANDIDATE_RECEIPTS)
        return observeCandidate(process.env.AMUN_CANDIDATE_RECEIPTS, id);
      const root = process.env.AMUN_CREW_RECEIPTS;
      const binary = process.env.AMUN_TMUX_BINARY;
      if (!root || !binary) return { endpoint: "unknown", worker: "unknown" };
      return observeOwnedTmux(root, id, binary, "m0");
    },
    (event) => port.postMessage(event),
  );
  let rosterBusy = false;
  let lastBoardRead: { scope: string; reader: BoardDiscovery } | undefined;
  let updatingFirstmate = false;
  port.on("message", (message) => {
    const response = handleHealthRequest(message.data);
    if (response) port.postMessage(response);
    else if (
      message.data?.kind === "refresh-crew" &&
      message.data.version === 1
    ) {
      if (rosterBusy) return;
      rosterBusy = true;
      void (async () => {
        const root = process.env.AMUN_CREW_RECEIPTS!,
          binary = process.env.AMUN_TMUX_BINARY!;
        const releases = await FirstmateReleases.open(
          workspaceRoot!,
          process.env.AMUN_FIRSTMATE_ARCHIVES!,
        );
        const { snapshot } = await readCrewBearings(releases);
        const keys = new Set([
          ...((await listReceiptTasks(root)) ?? []),
          ...[...snapshot.secondmates, ...snapshot.in_flight]
            .map((r) => r.id)
            .filter(
              (id): id is string =>
                typeof id === "string" && /^[-a-zA-Z0-9_]{1,64}$/.test(id),
            ),
        ]);
        const members = [];
        for (const id of keys)
          members.push(
            crewProfile(
              id,
              snapshot,
              await observeOwnedTmux(root, id, binary, "workspace"),
              redactor,
            ),
          );
        return members;
      })()
        .catch(() => null)
        .then((members) => {
          if (!closed) port.postMessage({ kind: "crew-roster", members });
        })
        .finally(() => {
          rosterBusy = false;
        });
    } else if (crewList.safeParse(message.data).success) {
      if (listingCrew) return;
      listingCrew = true;
      const root = process.env.AMUN_CREW_RECEIPTS;
      void (root ? listReceiptTasks(root) : Promise.resolve(null))
        .catch(() => null)
        .then((tasks) => {
          if (!closed)
            port.postMessage({ version: 1, kind: "crew-inventory", tasks });
        })
        .finally(() => {
          listingCrew = false;
        });
    } else if (
      message.data?.kind === "backlog-read" ||
      message.data?.kind === "ado-operation"
    ) {
      const parsed =
        message.data.kind === "ado-operation"
          ? adoOperation.safeParse(message.data)
          : backlogRead.safeParse(message.data);
      if (!parsed.success) return;
      const request = parsed.data;
      const context = workspaceService.snapshot().productContext;
      if (context?.productId !== request.productId) return;
      const source = context.sources.find(
        (s) => s.id === request.sourceId && s.kind === "ado",
      );
      const meta = {
        kind: "backlog-result",
        productId: request.productId,
        requestId: request.requestId,
      };
      const read = async () => {
        if (!source?.reference)
          throw Error("Map an Azure project in Product context.");
        const { connection, collection, project } = projectSource(
          source.reference,
          authMetadata.list(),
        );
        const secret = authKeyring().get(
          workspaceIdentity(workspace) + "/" + connectionId(connection),
        );
        if (!secret)
          throw Error("Connect the mapped Azure collection in Settings.");
        redactor.register(secret);
        const scope = JSON.stringify([
          request.productId,
          source.id,
          collection,
          project,
          createHash("sha256").update(secret).digest("hex"),
        ]);
        if (lastBoardRead?.scope !== scope) {
          lastBoardRead = {
            scope,
            reader: new BoardDiscovery(
              collection,
              project,
              azureTransport(collection, secret),
            ),
          };
        }
        const d = lastBoardRead.reader;
        if (request.kind === "ado-operation")
          return runAdoOperation(
            workspace,
            request,
            { collection, project, team: request.team },
            d,
            new AdoWriteClient(
              collection,
              project,
              azureTransport(collection, secret),
            ),
            () =>
              workspaceService.snapshot().preferences.productId ===
              request.productId,
          );
        if (request.action === "schema")
          return { ...meta, view: "schema", schema: await d.processSchema() };
        if (request.action === "teams")
          return { ...meta, view: "teams", teams: await d.teams() };
        if (request.action === "options") {
          return {
            ...meta,
            view: "options",
            levels: await d.levels(request.team),
          };
        }
        const level = (await d.levels(request.team)).find(
          (x) => x.id === request.level,
        );
        if (!level) throw Error("Unknown backlog level");
        const [settings, columns] = await Promise.all([
          d.boardSettings(request.team, level.name),
          d.columns(request.team, level.name),
        ]);
        return {
          ...meta,
          view: "cards",
          columns,
          cards: await d.cards(
            request.team,
            request.level,
            settings.columnField,
          ),
          canEditBoard: settings.canEdit,
        };
      };
      void read()
        .catch((error: unknown) => {
          const raw = error instanceof Error ? error.message : "";
          if (request.kind === "ado-operation")
            return {
              ...meta,
              kind: "ado-operation-result",
              message:
                raw === "revision_conflict"
                  ? "The Azure item changed. Your edits are retained. Reload its revision before saving."
                  : redactor.text(raw || "Azure operation failed."),
            };
          const message =
            raw === "request_rejected_403"
              ? "Azure denied read access to this board."
              : raw === "request_rejected_401"
                ? "Azure sign-in expired. Check the connection in Settings."
                : raw === "Connect the mapped Azure collection in Settings."
                  ? raw
                  : "Unable to read the mapped Azure project. Check its URL, VPN and connection.";
          return { ...meta, view: "error", message };
        })
        .then((reply) => {
          if (
            !closed &&
            workspaceService.snapshot().productContext?.productId ===
              request.productId
          )
            port.postMessage(reply);
        });
    } else if (message.data?.kind === "prototype") {
      const parsed = prototypeCommand.safeParse(message.data);
      if (!parsed.success) return;
      const cmd = parsed.data;
      void prototypes
        .handle(cmd)
        .catch((e: unknown) => ({
          kind: "prototype-result",
          id: cmd.id,
          product: cmd.product,
          objective: cmd.objective,
          message:
            e instanceof Error &&
            /^(Review|Pin |Open |Start |Prototype delivery)/.test(e.message)
              ? e.message
              : "Prototype output is unavailable. Check the Designer run and try again.",
        }))
        .then((r) => {
          if (
            !closed &&
            workspaceService.snapshot().preferences.productId === cmd.product
          ) {
            port.postMessage(r);
            port.postMessage(workspaceService.snapshot());
          }
        });
    } else if (message.data?.kind === "crew-delivery") {
      const parsed = deliveryCommand.safeParse(message.data);
      if (!parsed.success) return;
      const cmd = parsed.data,
        current = () =>
          closed ? null : workspaceService.snapshot().preferences.productId;
      void implementationRun(
        cmd,
        workspace,
        workspaceRoot!,
        current,
        async (id, text) => {
          const releases = await FirstmateReleases.open(
            workspaceRoot!,
            process.env.AMUN_FIRSTMATE_ARCHIVES!,
          );
          await supervisor.ensureRunning();
          return sendDelivery(
            releases,
            process.env.AMUN_CREW_RECEIPTS!,
            process.env.AMUN_TMUX_BINARY!,
            "codex",
            id,
            text,
          );
        },
        async (source, number) => {
          const r = await readPullWorkspace(
            {
              version: 1,
              kind: "pr-workspace",
              id: cmd.id,
              action: "details",
              product: cmd.product,
              source,
              number,
            },
            workspace,
            workspaceService.snapshot().productContext?.sources ?? [],
            current,
            repositoryCredential,
          );
          if (!r.detail) throw Error("Pull request unavailable.");
          return r.detail;
        },
      )
        .catch((error: unknown) => ({
          kind: "delivery-result",
          id: cmd.id,
          product: cmd.product,
          story: cmd.story,
          message:
            error instanceof Error &&
            /^(Select|Review|Check|Approve|Source commit|Local checkout|Repository mapping|Story changed)/.test(
              error.message,
            )
              ? redactor.text(error.message)
              : "Unable to prepare delivery. Verify the selected checkout and crew connection.",
        }))
        .then((r) => {
          if (current() === cmd.product) {
            port.postMessage(r);
            port.postMessage(workspaceService.snapshot());
          }
        });
    } else if (message.data?.kind === "pr-workspace") {
      const parsed = prCommand.safeParse(message.data);
      if (!parsed.success) return;
      const product = () =>
        closed ? null : workspaceService.snapshot().preferences.productId;
      void readPullWorkspace(
        parsed.data,
        workspace,
        workspaceService.snapshot().productContext?.sources ?? [],
        product,
        repositoryCredential,
      )
        .catch((e: unknown) => ({
          kind: "pr-result",
          id: parsed.data.id,
          product: parsed.data.product,
          message:
            e instanceof Error &&
            /^(Approve|Review|The PR|The current|Merge |Pull request changed|Refresh|Select |Connect |Map |Product changed|PR head|Text diff|Binary file)/.test(
              e.message,
            )
              ? redactor.text(e.message).slice(0, 512)
              : "Pull request operation unconfirmed. Refresh and check the repository connection.",
        }))
        .then((r) => {
          if (product() === parsed.data.product) port.postMessage(r);
        });
    } else if (message.data?.kind === "firstmate-chat") {
      void chatSession.handle(message.data);
    } else if (message.data?.kind === "product-authoring") {
      void workspaceService
        .author(message.data, (model, instruction, context) =>
          supervisor.productTurn(model, instruction, context),
        )
        .then((reply) => {
          if (!closed) port.postMessage(reply);
        });
    } else if (message.data?.kind === "document-import") {
      void workspaceService.importDocument(message.data).then((reply) => {
        if (!closed) port.postMessage(reply);
      });
    } else if (message.data?.kind === "stakeholder") {
      const parsed = updateCommand.safeParse(message.data);
      if (!parsed.success) return;
      const cmd = parsed.data;
      const active = () =>
        !closed &&
        workspaceService.snapshot().preferences.productId === cmd.productId;
      const reply = (fields: Record<string, unknown>) => {
        if (active())
          port.postMessage({
            version: 1,
            kind: "stakeholder-result",
            productId: cmd.productId,
            request: cmd.request,
            ...fields,
          });
      };
      if (!active() || updatingStakeholder) return;
      updatingStakeholder = true;
      void (async () => {
        const updates = new StakeholderUpdates(workspace);
        if (cmd.action === "draft") {
          updateReview = undefined;
          reply({
            title: "Stakeholder update",
            text: redactor.text(updates.draft(cmd.productId, cmd.objective)),
          });
          return;
        }
        if (cmd.action === "restore") {
          updateReview = undefined;
          const saved = workspace
            .prepare(
              "SELECT value_json FROM workspace_settings WHERE id='notion.destination'",
            )
            .pluck()
            .get();
          if (typeof saved !== "string")
            throw Error("Choose a Notion destination");
          const target = await notionConnection.inspectTarget(
            JSON.parse(saved),
          );
          if (!active() || !notionConnection.identity) return;
          const restored = notionReviews.restore(
            target,
            notionConnection.identity.workspaceId,
            cmd.productId,
          );
          if (restored.text.length > 100000)
            throw Error("Saved update exceeds the stakeholder limit");
          updateReview = {
            ...restored,
            product: cmd.productId,
            channel: "notion",
          };
          reply({
            title: restored.title,
            text: restored.text,
            draftText: restored.draftText,
            review: {
              id: restored.id,
              binding: restored.binding,
              destination: target.title + " · " + target.parentId,
              channel: "notion",
            },
          });
          return;
        }
        if (cmd.action === "review") {
          updateReview = undefined;
          const title = redactor.text(cmd.title),
            text = redactor.text(cmd.text);
          let reviewed;
          if (cmd.channel === "pdf")
            reviewed = updates.prepareExport(cmd.productId, title, text);
          else {
            const saved = workspace
              .prepare(
                "SELECT value_json FROM workspace_settings WHERE id='notion.destination'",
              )
              .pluck()
              .get();
            if (typeof saved !== "string")
              throw Error("Choose a Notion destination");
            const target = await notionConnection.inspectTarget(
              JSON.parse(saved),
            );
            if (!active() || !notionConnection.identity) return;
            const notion = notionReviews.prepare(
              { title, text },
              target,
              notionConnection.identity.workspaceId,
              cmd.productId,
            );
            reviewed = {
              ...notion,
              destination:
                target.title +
                " · " +
                target.parentId +
                (notion.markerPropertyId
                  ? " · Amun publication ID: " + notion.markerPropertyId
                  : ""),
            };
          }
          updateReview = {
            ...reviewed,
            product: cmd.productId,
            channel: cmd.channel,
          };
          reply({
            title: reviewed.title,
            text: reviewed.text,
            review: {
              id: reviewed.id,
              binding: reviewed.binding,
              destination: reviewed.destination,
              channel: cmd.channel,
            },
          });
          return;
        }
        const r = updateReview;
        updateReview = undefined;
        if (
          !r ||
          r.product !== cmd.productId ||
          r.id !== cmd.id ||
          r.binding !== cmd.binding ||
          r.channel !== cmd.channel ||
          r.title !== cmd.title ||
          r.text !== cmd.text
        )
          throw Error("Review changed");
        if (cmd.channel === "notion") {
          const result = await notionReviews.publish(cmd.id, cmd.binding);
          reply({
            message:
              result === "succeeded"
                ? "Published to Notion."
                : "Publication unconfirmed. Check the existing receipt.",
          });
          return;
        }
        updates.claimExport(
          cmd.productId,
          cmd.id,
          cmd.binding,
          cmd.title,
          cmd.text,
        );
        try {
          const dest = await writeStakeholderPdf(
            workspaceRoot,
            cmd.id,
            cmd.title,
            cmd.text,
          );
          workspace
            .transaction(() => {
              if (cmd.productId === null)
                workspace
                  .prepare("INSERT INTO portfolio_exports(id,path) VALUES(?,?)")
                  .run(cmd.id, dest);
              else
                workspace
                  .prepare(
                    "INSERT INTO artifacts(id,product_id,kind,path_or_uri) VALUES(?,?,'export',?)",
                  )
                  .run(cmd.id, cmd.productId, dest);
              actions.finish(cmd.id, "succeeded");
            })
            .immediate();
          reply({ message: "PDF saved to " + dest });
        } catch {
          actions.finish(cmd.id, "unknown");
          throw Error("Export unconfirmed");
        }
      })()
        .catch(() =>
          reply({
            message:
              "Update unavailable. Check the destination and review the exact content again.",
          }),
        )
        .finally(() => {
          updatingStakeholder = false;
        });
    } else if (message.data?.kind === "work") {
      for (const event of workStore.handle(message.data))
        port.postMessage(event);
    } else if (message.data?.kind === "council") {
      const parsed = councilCommand.safeParse(message.data);
      if (!parsed.success) return;
      const command = parsed.data;
      void (async () => {
        if (command.action === "run") {
          const started = await councilService.run(command);
          port.postMessage({
            version: 1,
            kind: "work-result",
            action: "council-run",
            ok: started.ok,
            message: started.ok ? "" : started.reason,
            ref: started.ok ? started.sessionId : null,
            step: null,
          });
          port.postMessage(workStore.snapshot());
        }
        const status =
          command.action === "toggle-seat"
            ? await councilService.toggleSeat(command.key, command.disabled)
            : command.action === "check-update"
              ? await councilService.checkUpdate(true)
              : command.action === "rollback"
                ? await councilService.rollback()
                : command.action === "room"
                  ? await councilService.openRoom()
                  : command.action === "close-room"
                    ? await councilService.closeRoom()
                    : await councilService.status();
        if (!closed) port.postMessage(status);
      })().catch(() => undefined);
    } else if (message.data?.kind === "workspace") {
      const sync = syncCommand.safeParse(message.data);
      if (sync.success) {
        if (syncingMemory) {
          port.postMessage({
            version: 1,
            kind: "workspace-error",
            message: "A memory sync is in progress.",
          });
          return;
        }
        syncingMemory = true;
        void workspaceService.memorySync
          .run(sync.data, notionConnection)
          .then(() => {
            if (!closed) port.postMessage(workspaceService.snapshot());
          })
          .catch(() => {
            if (!closed)
              port.postMessage({
                version: 1,
                kind: "workspace-error",
                message:
                  "Memory review changed or the mapping is unavailable. Refresh the product.",
              });
          })
          .finally(() => {
            syncingMemory = false;
          });
        return;
      }
      const reply = workspaceService.handle(message.data);
      if (reply?.kind === "workspace-snapshot")
        nativePi.selectProduct(reply.preferences.productId);
      if (reply) port.postMessage(reply);
    } else if (backendTerminalOpen.safeParse(message.data).success) {
      const request = backendTerminalOpen.parse(message.data);
      backendOpening = true;
      const epoch = ++backendEpoch;
      terminal.close();
      sessions.delete(terminal);
      const root = process.env.AMUN_CREW_RECEIPTS,
        binary = process.env.AMUN_TMUX_BINARY,
        modulePath = process.env.AMUN_TERMINAL_MODULE;
      if (!root || !binary || !modulePath) {
        backendOpening = false;
        return;
      }
      const native = requireNative(modulePath) as {
        spawn: (
          file: string,
          args: string[],
          options: unknown,
        ) => Pty & { pid: number };
      };
      void openBackendTerminal(
        root,
        request.taskId,
        binary,
        (file, args, options) => native.spawn(file, args, options),
      )
        .then((pty) => {
          if (closed || epoch !== backendEpoch) {
            pty.kill();
            return;
          }
          terminal = new TerminalSession(
            () => pty,
            (event) => port.postMessage(event),
            () =>
              outputs.audit("pm", "terminal.take-control", request.taskId, {
                backend: "tmux",
              }),
          );
          sessions.add(terminal);
          terminal.handle({ version: 1, kind: "terminal", action: "open" });
        })
        .catch(() => {
          if (!closed && epoch === backendEpoch)
            port.postMessage({
              version: 1,
              kind: "terminal-state",
              state: "unavailable",
            });
        })
        .finally(() => {
          if (epoch === backendEpoch) backendOpening = false;
        });
    } else if (piOpen.safeParse(message.data).success) {
      if (opening || pi) return;
      opening = true;
      const binary = process.env.AMUN_PI_BINARY;
      const entry = process.env.AMUN_PI_ENTRY;
      if (!binary || !entry) {
        opening = false;
        return;
      }
      const request = piOpen.parse(message.data);
      void openPiProtocol(
        binary,
        entry,
        (event) => {
          if (!closed) port.postMessage(event);
        },
        request.action === "open-provider" ? request.provider : "protocol",
        handleBridgeRequest(
          workspace,
          workspaceService.snapshot().preferences.productId,
          redactor,
        ),
      )
        .then((session) => {
          if (closed) session.close();
          else pi = session;
        })
        .catch(() => {
          if (!closed)
            port.postMessage({
              version: 1,
              kind: "pi-state",
              state: "unavailable",
            });
        })
        .finally(() => {
          opening = false;
        });
    } else {
      const nativeRequest = nativePiCommand.safeParse(message.data);
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "answer-extension" &&
        branchPicker.answer(nativeRequest.data)
      )
        return;
      if (nativeRequest.success && nativeRequest.data.action === "run") {
        const request = nativeRequest.data;
        if (request.command === "mcp" && request.argument === "obsidian") {
          const configured = authMetadata
            .list()
            .filter((c) => c.kind === "obsidian");
          if (configured.length !== 1) {
            sendNative(request.id, {
              kind: "message",
              text: configured.length
                ? "Select Test connection for the Obsidian endpoint you want in Settings → Connections."
                : "Open Settings → Connections → Obsidian to connect the Local REST API with MCP plugin.",
            });
            return;
          }
          void authBroker
            .check(configured[0]!)
            .then((status) =>
              sendNative(request.id, {
                kind: "message",
                text:
                  status === "ready"
                    ? "Obsidian MCP verified the vault read tool."
                    : "Obsidian is unavailable. Check the selected listener, certificate and saved plugin API key in Settings → Connections.",
              }),
            )
            .catch(() =>
              sendNative(request.id, {
                kind: "message",
                text: "Obsidian connection unavailable.",
              }),
            );
          return;
        }
        if (request.command === "supervision-model") {
          if (request.argument.trim()) {
            sendNative(request.id, {
              kind: "message",
              text: "Run /supervision-model without arguments.",
            });
            return;
          }
          void branchPicker
            .open(
              request.id,
              workspaceRoot!,
              process.env.AMUN_FIRSTMATE_ARCHIVES!,
              process.env.AMUN_PI_BINARY!,
              process.env.AMUN_PI_ENTRY!,
              process.env.AMUN_AUTH_ROOT!,
              (result) => sendNative(request.id, result),
            )
            .catch(() =>
              sendNative(request.id, {
                kind: "message",
                text: "Could not verify the Firstmate supervision model selection.",
              }),
            );
          return;
        }
        if (request.command === "calm") {
          if (togglingCalm || request.argument.trim()) {
            sendNative(request.id, {
              kind: "message",
              text: togglingCalm
                ? "Calm change already in progress."
                : "Run /calm without arguments.",
            });
            return;
          }
          togglingCalm = true;
          void FirstmateReleases.open(
            workspaceRoot!,
            process.env.AMUN_FIRSTMATE_ARCHIVES!,
          )
            .then((releases) =>
              toggleFirstmateCalm(
                releases,
                process.env.AMUN_PI_BINARY!,
                process.env.AMUN_PI_ENTRY!,
              ),
            )
            .then((text) => sendNative(request.id, { kind: "message", text }))
            .catch(() =>
              sendNative(request.id, {
                kind: "message",
                text: "Firstmate Calm could not be verified. Check the crew worktree and runtime.",
              }),
            )
            .finally(() => {
              togglingCalm = false;
            });
          return;
        }
        if (["ahoy", "afk", "quiet"].includes(request.command)) {
          void supervisor
            .run(request.command, request.argument)
            .then((text) => {
              if (request.command !== "ahoy")
                return sendNative(request.id, { kind: "message", text });
              ahoyPending.add(request.id);
              nativePi.handle({ ...request, command: "ahoy-recap" });
            })
            .catch(() =>
              sendNative(request.id, {
                kind: "message",
                text: "Firstmate could not verify this posture or its owned primary session.",
              }),
            );
          return;
        }
        if (request.command === "bearings") {
          void FirstmateReleases.open(
            workspaceRoot!,
            process.env.AMUN_FIRSTMATE_ARCHIVES!,
          )
            .then((releases) =>
              firstmateBearings(releases, request.argument, redactor),
            )
            .then((result) =>
              sendNative(
                request.id,
                typeof result === "string"
                  ? { kind: "message", text: result }
                  : result,
              ),
            )
            .catch((error: unknown) =>
              sendNative(request.id, {
                kind: "message",
                text:
                  error instanceof BoardError
                    ? error.message
                    : "Crew snapshot unavailable. Check the crew worktree and runtime dependencies.",
              }),
            );
          return;
        }
        if (request.command === "crew-dispatch") {
          if (crewDispatchBusy) {
            sendNative(request.id, {
              kind: "message",
              text: "A crew dispatch is in progress.",
            });
            return;
          }
          crewDispatchBusy = true;
          void (async () => {
            try {
              const releases = await FirstmateReleases.open(
                workspaceRoot!,
                process.env.AMUN_FIRSTMATE_ARCHIVES!,
              );
              const text = await dispatchFirstmate(
                releases,
                process.env.AMUN_CREW_RECEIPTS!,
                process.env.AMUN_TMUX_BINARY!,
                JSON.parse(request.argument),
              );
              try {
                await supervisor.ensureRunning();
                sendNative(request.id, { kind: "message", text });
              } catch {
                sendNative(request.id, {
                  kind: "message",
                  text:
                    text +
                    " Primary supervision could not start. Use /ahoy to retry.",
                });
              }
            } catch {
              sendNative(request.id, {
                kind: "message",
                text: "Firstmate could not dispatch this worker. Check the CLI installation, Amun subscription profile and crew worktree.",
              });
            } finally {
              crewDispatchBusy = false;
            }
          })();
          return;
        }
        if (request.command === "firstmate-release") {
          if (updatingFirstmate) {
            sendNative(request.id, {
              kind: "message",
              text: "A Firstmate runtime operation is already in progress.",
            });
            return;
          }
          updatingFirstmate = true;
          void (async () => {
            try {
              const releases = await FirstmateReleases.open(
                workspaceRoot!,
                process.env.AMUN_FIRSTMATE_ARCHIVES!,
              );
              let text: string;
              switch (request.argument) {
                case "status":
                  text =
                    "Selected Firstmate revision " +
                    (await releases.selected()).commit;
                  break;
                case "crew-home": {
                  const crew = await releases.crewHome();
                  text = "Crew home for " + crew.revision + " at " + crew.home;
                  break;
                }
                case "rollback":
                  text =
                    "Restored Firstmate revision " +
                    (await releases.rollback()).commit +
                    " for new worktrees.";
                  break;
                case "prepare": {
                  const prepared = await releases.prepare();
                  text =
                    "Prepared Firstmate " +
                    prepared.revision +
                    " at " +
                    prepared.home;
                  break;
                }
                default:
                  throw Error("Invalid action");
              }
              sendNative(request.id, { kind: "message", text });
            } catch {
              sendNative(request.id, {
                kind: "message",
                text: "Firstmate release operation failed. Check the retained package and workspace.",
              });
            } finally {
              updatingFirstmate = false;
            }
          })();
          return;
        }
        if (
          request.command === "hosting-save" ||
          (request.command === "mcp" &&
            request.argument === "cloudflare-hosting")
        ) {
          try {
            const destination =
              request.command === "hosting-save"
                ? saveHosting(workspace, JSON.parse(request.argument))
                : readHosting(workspace);
            sendNative(request.id, { kind: "hosting-setup", destination });
          } catch {
            sendNative(request.id, {
              kind: "message",
              text: "Hosting destination could not be saved or loaded. Enter a DNS hostname within your selected zone.",
            });
          }
          return;
        }
      }
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "run" &&
        nativeRequest.data.command === "mcp" &&
        nativeRequest.data.argument === "cloudflare-hosting-check"
      ) {
        const id = nativeRequest.data.id;
        const target = readHosting(workspace);
        if (target?.provider !== "cloudflare") {
          sendNative(id, { kind: "hosting-setup", destination: target });
          return;
        }
        if (cloudflareBusy) {
          sendNative(id, {
            kind: "message",
            text: "Cloudflare authorization is in progress.",
          });
          return;
        }
        cloudflareBusy = true;
        const account =
          workspaceIdentity(workspace) +
          "/cloudflare-" +
          createHash("sha256")
            .update("https://mcp.cloudflare.com/mcp")
            .digest("hex")
            .slice(0, 32);
        void inspectCloudflareHosting(
          {
            read: () => authKeyring().get(account),
            write: (value) => authKeyring().set(account, value),
            registerSecret: (value) => redactor.register(value),
            open: async (url) => {
              await promisify(execFile)(
                "/usr/bin/open",
                cloudflareConsentArgs(url),
                { timeout: 10000 },
              );
            },
          },
          target.zone,
          target.host,
        )
          .then((records) => {
            if (!closed)
              sendNative(id, {
                kind: "message",
                text:
                  "Cloudflare Code Mode verified " +
                  target.zone +
                  ". DNS records for " +
                  target.host +
                  ": " +
                  records +
                  ".",
              });
          })
          .catch(() => {
            if (!closed)
              sendNative(id, {
                kind: "message",
                text: "Cloudflare hosting inspection incomplete. Verify the account, consent and zone access.",
              });
          })
          .finally(() => {
            cloudflareBusy = false;
          });
        return;
      }
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "run" &&
        nativeRequest.data.command === "github-issue-publish"
      ) {
        const cmd = nativeRequest.data;
        void (async () => {
          const approval = notionApprovalRequest.parse(
            JSON.parse(cmd.argument),
          );
          const stored = JSON.parse(authKeyring().get(githubAccount) ?? "null");
          const token = githubGrant.parse(stored?.grant);
          if (
            !Number.isFinite(stored.savedAt) ||
            (token.expires_in &&
              Date.now() >= stored.savedAt + token.expires_in * 1000)
          )
            throw Error("Expired");
          const review = new GithubIssueReview(workspace);
          const outcome = await review.publish(
            approval.reviewId,
            approval.binding,
            (issue) => createGithubIssue(token.access_token, issue),
          );
          if (!closed)
            sendNative(cmd.id, {
              kind: "message",
              text:
                outcome === "succeeded"
                  ? "GitHub issue created: https://github.com/tamer-sabry8/amun/issues/" +
                    review.receipt(approval.reviewId)
                  : "Issue creation is unconfirmed. Check GitHub before any further write.",
            });
        })().catch(() => {
          if (!closed)
            sendNative(cmd.id, {
              kind: "message",
              text: "GitHub approval could not be used. Check the issue and saved connection.",
            });
        });
        return;
      }
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "run" &&
        nativeRequest.data.command === "mcp" &&
        [
          "github-repo-connect",
          "github-connect",
          "github-open",
          "github-finish",
          "github-cancel",
          "github-read",
          "github-issue-review",
        ].includes(nativeRequest.data.argument)
      ) {
        const cmd = nativeRequest.data;
        void (async () => {
          const showCode = () =>
            sendNative(cmd.id, {
              kind: "github-device",
              code: githubLogin.userCode!,
            });
          if (
            cmd.argument === "github-connect" ||
            cmd.argument === "github-repo-connect"
          ) {
            await githubLogin.start(
              cmd.argument === "github-repo-connect" ? "repo" : "public_repo",
            );
            showCode();
            return;
          }
          if (cmd.argument === "github-open") {
            await githubLogin.openBrowser();
            showCode();
            return;
          }
          if (cmd.argument === "github-cancel") {
            githubLogin.cancel();
            sendNative(cmd.id, {
              kind: "message",
              text: "GitHub sign-in cancelled.",
            });
            return;
          }
          if (
            cmd.argument === "github-finish" &&
            (await githubLogin.check()) === "pending"
          ) {
            showCode();
            return;
          }
          if (cmd.argument === "github-issue-review") {
            const receipt = new GithubIssueReview(workspace).completedIssue();
            if (receipt) {
              sendNative(cmd.id, {
                kind: "message",
                text:
                  "Previously created GitHub issue: https://github.com/tamer-sabry8/amun/issues/" +
                  receipt,
              });
              return;
            }
          }
          const stored = authKeyring().get(githubAccount);
          if (!stored) {
            sendNative(cmd.id, {
              kind: "message",
              text: "GitHub is disconnected. Choose Sign in with Microsoft Edge to connect.",
            });
            return;
          }
          const { grant, savedAt } = JSON.parse(stored);
          const token = githubGrant.parse(grant);
          if (
            typeof savedAt !== "number" ||
            (token.expires_in &&
              Date.now() >= savedAt + 1000 * token.expires_in)
          ) {
            sendNative(cmd.id, {
              kind: "message",
              text: "GitHub sign-in has expired. Reconnect with Microsoft Edge.",
            });
            return;
          }
          if (cmd.argument === "github-issue-review") {
            const review = new GithubIssueReview(workspace);
            try {
              sendNative(cmd.id, {
                kind: "github-issue-review",
                ...review.prepare(),
              });
            } catch {
              sendNative(cmd.id, {
                kind: "message",
                text: "This workspace already submitted or changed this issue. Inspect GitHub before any further write.",
              });
            }
            return;
          }
          await checkGithubMcp(token.access_token);
          sendNative(cmd.id, {
            kind: "message",
            text: "GitHub MCP connected. Read package.json from tamer-sabry8/amun.",
          });
        })().catch((error: unknown) => {
          if (!closed)
            sendNative(cmd.id, {
              kind: "message",
              text:
                error instanceof GithubReadFailure
                  ? error.message
                  : "GitHub operation could not be verified. Check the saved connection or start a new sign-in.",
            });
        });
        return;
      }
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "run" &&
        [
          "notion-review",
          "notion-publish",
          "notion-receipts",
          "notion-reconcile",
        ].includes(nativeRequest.data.command)
      ) {
        const command = nativeRequest.data;
        if (notionReviewBusy) {
          sendNative(command.id, {
            kind: "message",
            text: "Wait for the current Notion review operation.",
          });
          return;
        }
        notionReviewBusy = true;
        void (async () => {
          if (command.command === "notion-reconcile") {
            const input = JSON.parse(command.argument) as {
              id: string;
              url?: string;
            };
            if (
              typeof input.id !== "string" ||
              (input.url !== undefined &&
                (typeof input.url !== "string" || input.url.length > 2048))
            )
              throw Error("Invalid lookup");
            if (
              !workspace
                .prepare(
                  "SELECT id FROM actions WHERE id=? AND product_id IS ?",
                )
                .get(
                  input.id,
                  workspaceService.snapshot().preferences.productId,
                )
            )
              throw Error("Review unavailable in this product");
            const status = await notionReviews.check(
              input.id,
              lookupPublication,
              input.url,
            );
            const text = {
              confirmed:
                "Confirmed in Notion. Open Published conversations for the verified page.",
              wait: "A recent search is still within its backoff period. Try again later.",
              missing:
                "No unique matching publication reference was found. Retry the search later or paste its Notion page URL.",
              blocked:
                "Notion lookup is unavailable. Amun will retry the read after backoff.",
            }[status];
            sendNative(command.id, { kind: "message", text });
          } else if (command.command === "notion-receipts") {
            sendNative(command.id, {
              kind: "publication-receipts",
              unconfirmed: notionReviews
                .unconfirmed(workspaceService.snapshot().preferences.productId)
                .map((item) => ({
                  ...item,
                  delivery: notionReviews.deliveryState(item.id),
                  title: redactor.text(item.title).slice(0, 256),
                })),
              pages: notionReviews
                .receipts(workspaceService.snapshot().preferences.productId)
                .map((page) => ({ ...page, title: redactor.text(page.title) })),
            });
          } else if (command.command === "notion-publish") {
            const approval = notionApprovalRequest.parse(
              JSON.parse(command.argument),
            );
            if (
              !workspace
                .prepare(
                  "SELECT id FROM actions WHERE id=? AND product_id IS ?",
                )
                .get(
                  approval.reviewId,
                  workspaceService.snapshot().preferences.productId,
                )
            )
              throw Error("Review unavailable in this product");
            const outcome = await notionReviews.publish(
              approval.reviewId,
              approval.binding,
            );
            sendNative(command.id, {
              kind: "message",
              text:
                outcome === "succeeded"
                  ? "The reviewed conversation was published as a new Notion page."
                  : notionReviews.deliveryState(approval.reviewId) ===
                      "not sent"
                    ? "The request did not reach the send step. Reconnect Notion and review the conversation again."
                    : "Publication outcome is unconfirmed. Do not retry; reconciliation is required to avoid a duplicate page.",
            });
          } else {
            const preview = notionPreview;
            if (!preview || Date.now() - preview.at > 600000)
              throw Error("Conversation preview expired");
            const row = workspace
              .prepare(
                "SELECT value_json FROM workspace_settings WHERE id='notion.destination'",
              )
              .get() as { value_json: string } | undefined;
            if (!row) {
              sendNative(command.id, {
                kind: "message",
                text: "First check your Notion destination in Settings → Connections. Nothing has been published.",
              });
              return;
            }
            const target = await notionConnection.inspectTarget(
              JSON.parse(row.value_json) as string,
            );
            const identity = notionConnection.identity;
            if (!identity) throw Error("Notion workspace unavailable");
            const review = notionReviews.prepare(
              {
                title: redactor.text(preview.title),
                text: redactor.text(preview.text),
              },
              target,
              identity.workspaceId,
              workspaceService.snapshot().preferences.productId,
            );
            sendNative(command.id, {
              kind: "notion-review",
              reviewId: review.id,
              ...(review.markerPropertyId
                ? { markerPropertyId: review.markerPropertyId }
                : {}),
              binding: review.binding,
              title: review.title,
              text: review.text,
              destination: review.destination,
              destinationId: target.parentId,
            });
          }
        })()
          .catch(() =>
            sendNative(command.id, {
              kind: "message",
              text:
                command.command === "notion-publish"
                  ? "Publication could not be confirmed. Do not retry until its outcome has been checked."
                  : "Amun could not prepare this Notion review. Check the destination and connection, then preview the conversation again. Nothing was published.",
            }),
          )
          .finally(() => {
            notionReviewBusy = false;
          });
        return;
      }
      if (nativeRequest.success) notionPreview = undefined;
      nativePi.handle(message.data);
      const parsedAuth = authCommand.safeParse(message.data);
      if (
        parsedAuth.success &&
        [
          "notion-connect",
          "notion-check",
          "notion-cancel",
          "notion-disconnect",
          "notion-target",
        ].includes(parsedAuth.data.action)
      ) {
        const command = parsedAuth.data;
        if (command.action === "notion-target") {
          void notionConnection
            .inspectTarget(command.url)
            .then((destination) => {
              workspace
                .prepare(
                  "INSERT INTO workspace_settings(id,value_json) VALUES ('notion.destination',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
                )
                .run(JSON.stringify(command.url));
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message: redactor.text(
                  `Notion verified ${destination.title} (${destination.parentType === "data_source_id" ? "database" : "page"}). Publication is still blocked until content and destination are reviewed.`,
                ),
              });
            })
            .catch(() =>
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Amun could not verify this Notion destination. Check its link and workspace access. Nothing was published.",
              }),
            );
        } else if (command.action === "notion-disconnect") {
          notionPreview = undefined;
          void notionConnection
            .disconnect()
            .then(() => {
              workspace
                .prepare(
                  "DELETE FROM workspace_settings WHERE id='notion.destination'",
                )
                .run();
              port.postMessage({
                version: 1,
                kind: "auth-status",
                id: "notion-mcp",
                status: "missing",
              });
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Notion disconnected from this Amun workspace. Saved credentials and destination were removed. Existing Notion pages are unchanged. Manage server-side access in Notion if you also want to revoke the grant.",
              });
            })
            .catch(() => {
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Notion disconnect could not be completed. Your connection status has not been confirmed.",
              });
            });
        } else if (command.action === "notion-cancel")
          notionConnection.cancelLogin();
        else if (
          command.action === "notion-connect" ||
          command.action === "notion-check"
        ) {
          port.postMessage({
            version: 1,
            kind: "auth-status",
            id: "notion-mcp",
            status: "checking",
          });
          void notionConnection
            .connect(
              command.action === "notion-connect" ? command.browser : "edge",
              command.action === "notion-connect",
            )
            .then(() => {
              port.postMessage({
                version: 1,
                kind: "auth-status",
                id: "notion-mcp",
                status: "ready",
              });
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message: redactor.text(
                  `Notion MCP connected to ${notionConnection.identity?.workspaceName ?? "your workspace"}. Publishing still requires review.`,
                ),
              });
            })
            .catch(() => {
              port.postMessage({
                version: 1,
                kind: "auth-status",
                id: "notion-mcp",
                status: "error",
              });
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Notion sign-in or access check did not complete. Reconnect in your selected browser; no content was published.",
              });
            });
        }
      } else void auth.handle(message.data);
      void crew.handle(message.data);
      if (
        message.data?.kind === "terminal" &&
        ["close", "open"].includes(message.data.action)
      ) {
        backendEpoch++;
        backendOpening = false;
        if (message.data.action === "open" && terminal !== localTerminal) {
          terminal.close();
          sessions.delete(terminal);
          terminal = localTerminal;
          sessions.add(terminal);
        }
      }
      if (!backendOpening) terminal.handle(message.data);
      void pi?.handle(message.data);
      if (message.data?.kind === "pi" && message.data?.action === "close")
        pi = undefined;
    }
  });
  port.on("close", () => {
    closed = true;
    githubLogin.cancel();
    nativePi.close();
    auth.close();
    authSessions.delete(auth);
    crew.close();
    pi?.close();
    terminal.close();
    sessions.delete(terminal);
    if (home) rmSync(home, { recursive: true, force: true });
  });
  port.start();
});
process.on("exit", () => {
  for (const auth of authSessions) auth.close();
  workspace.close();
  for (const terminal of sessions) terminal.close();
});
