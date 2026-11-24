import { findPrdReport, forwardPrdReport, isPrdRelayReply, prdRelayPrompt, type PrdReport } from "./prd-report-relay.js";
import { crewHome, readCrewDocument, reportedMarkdownPaths } from "./crew-documents.js";
import { scheduleBlockerChecks } from "./blocker-checks.js";
import type { IncomingMessage, Server as HTTPServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { fleetSnapshotSchema, type AmunEvent } from "@getpaseo/protocol/amun-rpc";
import type { AgentManager, ManagedAgent } from "../agent/agent-manager.js";
import { AmunRpcHandler } from "./amun-rpc-handler.js";
import { resolveAmunPaths } from "./amun-paths.js";
import {
  holdsFromSnapshot,
  peekCrew,
  readFleetSnapshot,
  shareFleetSnapshots,
} from "./firstmate-cli.js";
import { ConnectionStore } from "./connections/connection-store.js";
import { keychainSecretStore } from "./connections/secret-store.js";
import { PmStore } from "./pm-store.js";
import {
  openAdo,
  openCouncil,
  openNotion,
  openTrackers,
  openWorkStore,
  readRequestBlocks,
  recordFirstMateReply,
} from "@amun/work-store";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TraceLog } from "./trace/trace-log.js";
import { PrimarySessions, type PrimaryHost, type PrimaryLaunch } from "./primary-session.js";
import { FirstMateRecords } from "./first-mate-records.js";
import {
  checkPiAccount,
  FirstMateModelChoice,
  piOnPath,
  type ListedModel,
  type ModelHost,
} from "./first-mate-models.js";
import { ProductSpaceStore } from "./product-spaces.js";
import {
  UnpromptedTurns,
  isAllClear,
  repliesInRun,
  type UnpromptedReply,
} from "./unprompted-turns.js";

/** Replies to wakes that arrived while the First Mate answered the owner. */
const laterReplies: { current: ((reply: { agentId: string; text: string }) => void) | null } = {
  current: null,
};
import { serveNotionForFirstMate } from "./notion-for-first-mate.js";
import { serveTrackersForFirstMate } from "./trackers-for-first-mate.js";
import { OutputPreviewHost } from "./output-preview.js";


/** The work contract's limit on an `apply-reply` text. */
const APPLY_REPLY_LIMIT = 200_000;

/** Where each request's own message is, from the work snapshot. */
interface RequestLocations {
  requests: { ref: string; messageId: string }[];
  messages: { id: string; workAreaId: string }[];
  chats: { messages: { id: string; workAreaId: string }[] }[];
}

export const AMUN_WS_PATH = "/amun";
const FLEET_POLL_MS = 5_000;
const COUNCIL_POLL_MS = 1_500;
const FIRST_MATE_RPC_TIMEOUT_MS = 5 * 60_000;
const COUNCIL_UPDATE_CHECK_MS = 6 * 3_600_000;

interface AmunLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface AttachAmunInput {
  httpServer: HTTPServer;
  agentManager: AgentManager;
  logger: AmunLogger;
  env?: NodeJS.ProcessEnv;
  /** $PASEO_HOME/daemon.log, copied into trace bundles. */
  daemonLog?: string;
  /** The daemon's trusted browser origins (CORS config plus the desktop app). */
  allowedOrigins?: () => ReadonlySet<string>;
  /** The models Pi offers from its signed-in accounts (Paseo's Pi provider). */
  listPiModels?: () => Promise<ListedModel[]>;
  /**
   * Loads a stored agent that is not archived and was launched with this
   * provider in this folder, resuming its session. Returns null, without
   * opening any session, when there is no such agent. Lets a restarted daemon
   * bring back the same First Mate.
   */
  loadAgent?: (agentId: string, expected: StoredAgentMatch) => Promise<ManagedAgent | null>;
}

/** What a stored agent must have been launched with to be resumed. */
export interface StoredAgentMatch {
  provider: string;
  cwd: string;
  firstmateHome?: string;
}

export interface AmunAttachment {
  handler: AmunRpcHandler;
  close(): void;
}

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Browsers send an Origin header; a page from any website would otherwise
 * reach /amun because the browser itself is on loopback. Allow non-browser
 * clients (no Origin), the daemon's trusted origins, and pages served from
 * this machine over http (Amun's UI in development).
 */
export function isAmunOriginAllowed(
  origin: string | undefined,
  allowed: ReadonlySet<string> = new Set(),
): boolean {
  if (origin === undefined) return true;
  if (allowed.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function pathOf(request: IncomingMessage): string {
  const url = request.url ?? "";
  const index = url.indexOf("?");
  return index === -1 ? url : url.slice(0, index);
}

export function agentManagerHost(
  agentManager: AgentManager,
  loadAgent?: (agentId: string, expected: StoredAgentMatch) => Promise<ManagedAgent | null>,
): PrimaryHost {
  return {
    ...(loadAgent
      ? {
          async resumeAgent(agentId: string, launch: PrimaryLaunch) {
            // Only this home's First Mate: same harness, same Firstmate checkout.
            // The stored record is checked before any session is opened.
            const agent = await loadAgent(agentId, {
              provider: launch.provider,
              cwd: launch.cwd,
              ...(launch.env.FM_HOME ? { firstmateHome: launch.env.FM_HOME } : {}),
            });
            if (!agent) return false;
            if (agent.provider !== launch.provider || agent.cwd !== launch.cwd) {
              // Never leave a rejected First Mate running beside the new one.
              await agentManager.closeAgent(agentId).catch(() => undefined);
              return false;
            }
            if (launch.model)
              await agentManager.setAgentModel(agentId, launch.model).catch(() => undefined);
            return true;
          },
        }
      : {}),
    async createAgent(launch) {
      const agent = await agentManager.createAgent(
        {
          provider: launch.provider,
          cwd: launch.cwd,
          title: launch.title,
          // Pi starts slowly in a busy Firstmate home, and its first reply to
          // a message can take more than the default minute.
          ...(launch.provider === "pi"
            ? { providerOptions: { rpcTimeoutMs: FIRST_MATE_RPC_TIMEOUT_MS } }
            : {}),
        },
        undefined,
        { env: launch.env, initialTitle: launch.title, workspaceId: undefined },
      );
      // A saved model that Pi no longer offers must not stop the First Mate.
      if (launch.model)
        await agentManager.setAgentModel(agent.id, launch.model).catch(() => undefined);
      return { agentId: agent.id };
    },
    async runAgent(agentId, text, collectFollowups, onCaptainReply) {
      const foreground: { type: string; text?: unknown }[] = [];
      let earlyReply = false;
      const result = await agentManager.runAgent(agentId, text, undefined,
        onCaptainReply ? (item) => {
          if (earlyReply) return;
          // A subsequent user message seals the captain's portion even
          // while Pi continues running tools for a watcher wake.
          if (item.type === "user_message") {
            const [answer] = repliesInRun(foreground);
            if (answer) {
              earlyReply = true;
              onCaptainReply(answer);
              return;
            }
          }
          foreground.push(item);
        } : undefined,
      );
      const [reply, ...later] = repliesInRun(result.timeline);
      if (collectFollowups && !earlyReply) {
        return { finalText: reply ?? result.finalText, followups: later.filter((text) => !isAllClear(text)) };
      }
      for (const text of later) laterReplies.current?.({ agentId, text });
      return { finalText: reply ?? result.finalText };
    },
    async cancelRun(agentId) {
      await agentManager.cancelAgentRun(agentId);
    },
  };
}

/** The model picker's view of Paseo: Pi's catalog and the running agent's model. */
export function agentManagerModelHost(
  agentManager: AgentManager,
  listPiModels: () => Promise<ListedModel[]>,
): ModelHost {
  function currentModel(agentId: string): string | null {
    const agent = agentManager.getAgent(agentId);
    return agent?.runtimeInfo?.model ?? agent?.config.model ?? null;
  }
  return {
    listModels: listPiModels,
    currentModel,
    async setModel(agentId, model) {
      await agentManager.setAgentModel(agentId, model);
      return currentModel(agentId);
    },
  };
}

/**
 * Mounts Amun's JSON RPC on the Paseo daemon's HTTP server at /amun. Loopback
 * only: the daemon is local-first and the public relay is off by default.
 */
export function attachAmun(input: AttachAmunInput): AmunAttachment | null {
  const env = input.env ?? process.env;
  if (env.AMUN_DISABLE === "1") return null;
  let paths: ReturnType<typeof resolveAmunPaths>;
  try {
    paths = resolveAmunPaths(env);
  } catch (error) {
    input.logger.warn({ err: error }, "Amun RPC not mounted: Firstmate not found");
    return null;
  }
  const spaces = new ProductSpaceStore(paths);
  mkdirSync(paths.amunHome, { recursive: true });
  const work = openWorkStore(path.join(paths.amunHome, "work.db"));
  const connections = new ConnectionStore(paths.amunHome, keychainSecretStore());
  const trace = new TraceLog({ dir: path.join(paths.amunHome, "trace"), redactor: work.redactor });
  const modelChoice = new FirstMateModelChoice(paths.amunHome);
  const primary = new PrimarySessions(
    agentManagerHost(input.agentManager, input.loadAgent),
    paths.firstmateRoot,
    () => modelChoice.read(),
    new FirstMateRecords(paths.amunHome),
  );
  const runPi = piOnPath(() => env.PATH ?? "");
  // Notion signs in through its hosted MCP server; the grant lives in the
  // Keychain under the same service as Amun's other connections.
  const notion = openNotion(work, {
    root: path.join(paths.amunHome, "notion"),
    workspace: "amun",
    secrets: keychainSecretStore(),
  });
  // Linear and Jira sign in through their hosted MCP servers; each grant is
  // one Keychain entry for this workspace and provider.
  const trackers = openTrackers(work, {
    root: path.join(paths.amunHome, "trackers"),
    workspace: "amun",
    secrets: keychainSecretStore(),
  });
  // The Council keeps its advisors, sessions and questions in Amun's own home.
  const council = openCouncil(work, {
    root: path.join(paths.amunHome, "roast-room"),
    vendor: env.AMUN_COUNCIL_VENDOR ?? null,
    path: () => env.PATH ?? "",
  });
  // The last snapshot is kept in Amun's own home, so questions and crew show
  // when the app opens instead of minutes later on a busy home.
  const snapshotFile = (fmHome: string) =>
    path.join(
      paths.amunHome,
      "fleet-snapshots",
      `${createHash("sha256").update(fmHome).digest("hex").slice(0, 32)}.json`,
    );
  const snapshots = shareFleetSnapshots(
    (fmHome) => readFleetSnapshot({ root: paths.firstmateRoot, fmHome }),
    {
      deferRefresh: (fmHome) => primary.pending(fmHome) > 0,
      load(fmHome) {
        try {
          const kept = fleetSnapshotSchema.safeParse(
            JSON.parse(readFileSync(snapshotFile(fmHome), "utf8")),
          );
          return kept.success ? kept.data : null;
        } catch {
          return null;
        }
      },
      save(fmHome, snapshot) {
        const file = snapshotFile(fmHome);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(snapshot), { mode: 0o600 });
      },
    },
  );
  const ado = openAdo(work, {
    connections: () => connections.list(),
    secret: async (connection) =>
      (await connections.token({ kind: "ado", baseUrl: connection.baseUrl })) ?? null,
  });
  const previews = new OutputPreviewHost();
  const handler = new AmunRpcHandler({
    spaces,
    primary,
    connections,
    work: work.store,
    workspace: work.workspace,
    tools: work.tools,
    council,
    notion,
    trackers,
    previews,
    workChanged: () => {
      for (const ws of wss.clients) send(ws, { event: "work.updated" });
    },
    emit: (message) => {
      const event: AmunEvent = { event: "renderer.event", message };
      for (const ws of wss.clients) send(ws, event);
    },
    ado,
    amunHome: paths.amunHome,
    firstmateRoot: paths.firstmateRoot,
    readSnapshot: (fmHome) => snapshots.read(fmHome),
    peekCrew: (fmHome, taskId) => peekCrew({ root: paths.firstmateRoot, fmHome }, taskId),
    trace,
    redactor: work.redactor,
    daemonLog: input.daemonLog ?? null,
    fmHome: paths.fmHome,
    models: agentManagerModelHost(input.agentManager, input.listPiModels ?? (async () => [])),
    modelChoice,
    checkAccount: (provider) => checkPiAccount(provider, runPi),
    onOnceReply: (text) => {
      if (text.trim()) showUnprompted({ fmHome: paths.fmHome, agentId: "", text });
    },
    readTimeline: async (fmHome) => {
      const agentId = primary.agentFor(fmHome);
      return agentId ? input.agentManager.getTimelineRows(agentId) : [];
    },
  });
  trace.record({ source: "amun", kind: "daemon-start", fmHome: paths.fmHome });
  // The First Mate reads the captain's Notion through Amun's connection.
  let notionForFirstMate: ReturnType<typeof serveNotionForFirstMate> | null = null;
  try {
    notionForFirstMate = serveNotionForFirstMate({ amunHome: paths.amunHome, notion });
  } catch (error) {
    input.logger.warn({ err: error }, "Notion for the First Mate not available");
  }
  // The First Mate sees Linear and Jira status and plan targets (read only).
  let trackersForFirstMate: ReturnType<typeof serveTrackersForFirstMate> | null = null;
  try {
    trackersForFirstMate = serveTrackersForFirstMate({ amunHome: paths.amunHome, trackers });
  } catch (error) {
    input.logger.warn({ err: error }, "Linear and Jira for the First Mate not available");
  }
  // A Linear or Jira write a crash left unconfirmed is looked up, never resent.
  void trackers.recover().then(
    (events) => {
      if (events.length) for (const ws of wss.clients) send(ws, { event: "work.updated" });
    },
    (error: unknown) => input.logger.warn({ err: error }, "Linear and Jira recovery did not finish"),
  );
  const wss = new WebSocketServer({ noServer: true, maxPayload: 12 * 1024 * 1024 });
  const watched = new Map<WebSocket, Set<string>>();
  const lastSent = new Map<string, string>();

  function send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (pathOf(request) !== AMUN_WS_PATH) return;
    const origin = request.headers.origin;
    if (!isLoopback(request) || !isAmunOriginAllowed(origin, input.allowedOrigins?.())) {
      input.logger.warn({ origin }, "Rejected /amun connection");
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  };
  input.httpServer.on("upgrade", onUpgrade);

  wss.on("connection", (ws: WebSocket) => {
    watched.set(ws, new Set());
    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(data));
      } catch {
        send(ws, { id: "unknown", ok: false, error: { code: "InvalidJson", message: "not JSON" } });
        return;
      }
      const space =
        typeof raw === "object" && raw !== null && "space" in raw && typeof raw.space === "string"
          ? raw.space
          : null;
      if (space) watched.get(ws)?.add(space);
      void handler.handleRaw(raw).then((response) => send(ws, response));
    });
    ws.on("close", () => watched.delete(ws));
  });

  // Push fleet and hold changes for every space a connected UI has touched.
  const timer = setInterval(() => {
    const slugs = new Set<string>();
    for (const set of watched.values()) for (const slug of set) slugs.add(slug);
    for (const slug of slugs) {
      void spaces
        .get(slug)
        .then((space) => snapshots.readFresh(space.fmHome))
        .then((snapshot) => {
          const { generated: _generated, ...stable } = snapshot;
          const digest = JSON.stringify(stable);
          if (lastSent.get(slug) === digest) return;
          lastSent.set(slug, digest);
          // Keep the board in step with Firstmate's own backlog transitions.
          const store = PmStore.forHome(snapshot.fm_home, paths.amunHome);
          try {
            store.projectBacklog(snapshot.backlog.records);
          } finally {
            store.close();
          }
          const events: AmunEvent[] = [
            { event: "fleet.updated", space: slug, snapshot },
            { event: "holds.updated", space: slug, holds: holdsFromSnapshot(snapshot) },
          ];
          for (const [ws, set] of watched) if (set.has(slug)) for (const e of events) send(ws, e);
        })
        .catch((error: unknown) => input.logger.warn({ err: error, space: slug }, "amun fleet poll failed"));
    }
  }, FLEET_POLL_MS);
  timer.unref();

  // A First Mate turn Amun did not ask for (a heartbeat, a Firstmate wake or
  // guard notice) has a reply nobody is waiting on. It is kept in the
  // standing "Chat with Firstmate" conversation and every UI is told.
  function showUnprompted(reply: UnpromptedReply, prdRelay = false): void {
    if (isAllClear(reply.text)) return;
    let saved: string | null = null;
    try {
      const agent = input.agentManager.getAgent(reply.agentId);
      saved = recordFirstMateReply(
        work.store,
        reply.text,
        agent?.runtimeInfo?.model ?? agent?.config.model ?? null,
        prdRelay,
      );
      if (work.workspace.registerCrewStoryDrafts && reply.text.includes("```amun")) {
        for (const draft of readRequestBlocks(reply.text).storyDrafts) {
          const filed = work.workspace.registerCrewStoryDrafts(
            draft.request,
            draft.stories,
            draft.objectiveId,
            draft.expectedVersion,
          );
          if (filed) saved = saved ?? "story-drafts";
        }
      }
    } catch (error) {
      input.logger.warn({ err: error }, "amun could not keep a First Mate reply");
    }
    trace.record({
      source: "chat",
      kind: "message",
      from: "first-mate",
      to: "captain",
      unprompted: true,
      text: reply.text,
    });
    for (const [ws, set] of watched)
      for (const slug of set)
        void spaces
          .get(slug)
          .then((space) => {
            if (space.fmHome !== reply.fmHome) return;
            const event: AmunEvent = {
              event: "primary.output",
              space: slug,
              agentId: reply.agentId,
              text: reply.text,
            };
            send(ws, event);
          })
          .catch(() => undefined);
    if (saved) {
      const event: AmunEvent = { event: "work.updated" };
      for (const ws of wss.clients) send(ws, event);
    }
  }
  const unprompted = new UnpromptedTurns({
    homeOf: (agentId) => primary.homeOf(agentId),
    isAmunTurn: (agentId) => primary.isAmunTurn(agentId),
    onReply: showUnprompted,
  });
  laterReplies.current = ({ agentId, text }) => {
    const fmHome = primary.homeOf(agentId);
    if (fmHome) showUnprompted({ fmHome, agentId, text });
  };
  const stopWatchingTurns = input.agentManager.subscribe(
    (event) => {
      try {
        unprompted.handle(event);
      } catch (error) {
        input.logger.warn({ err: error }, "amun turn watch failed");
      }
    },
    { replayState: false },
  );

  // A matched PRD report names the documents PRD wrote. Amun files each
  // Markdown file inside PRD's own home with that request: in the Library,
  // and for a product as its next PRD version, where the existing review,
  // approval and "Generate stories" take over. Approval stays the captain's.
  const registeredCrewDocuments = new Set<string>();
  async function registerCrewDocuments(home: string, report: PrdReport): Promise<string[]> {
    const files = reportedMarkdownPaths(report.text).filter(
      (file) => !registeredCrewDocuments.has(`${report.ref} ${file}`),
    );
    if (!files.length) return [];
    const crew = await crewHome({ fmHome: home, taskId: "prd" });
    if (!crew) return [];
    const snapshot = work.store.snapshot() as RequestLocations;
    const request = snapshot.requests.find((item) => item.ref === report.ref);
    const messages = [
      ...snapshot.messages,
      ...snapshot.chats.flatMap((chat) => chat.messages),
    ];
    const areaId = request
      ? messages.find((message) => message.id === request.messageId)?.workAreaId
      : undefined;
    if (!areaId) return [];
    const filed: string[] = [];
    for (const file of files) {
      registeredCrewDocuments.add(`${report.ref} ${file}`);
      const document = await readCrewDocument({ file, home: crew });
      if (!document) continue;
      // Backticks are escaped so the document cannot close the block early.
      const block = JSON.stringify({
        do: "document",
        request: report.ref,
        title: document.title,
        type: document.kind,
        body: document.markdown,
      }).replaceAll("`", "\\u0060");
      if (document.kind === "prd") {
        work.workspace.registerCrewPrd?.(report.ref, document.markdown, document.title);
      }
      const text = "```amun\n" + block + "\n```";
      // apply-reply takes at most 200,000 characters; a longer document stays
      // a file, and only a document the store confirms is called filed.
      if (text.length > APPLY_REPLY_LIMIT) continue;
      const events = work.store.handle({
        version: 1,
        kind: "work",
        action: "apply-reply",
        text,
        workAreaId: areaId,
        chatId: null,
        saveText: false,
      }) as unknown[];
      const saved = events.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { kind?: unknown; ok?: unknown }).kind === "work-result" &&
          (event as { ok?: unknown }).ok === true,
      );
      if (saved) filed.push(document.title);
    }
    return filed;
  }

  // A known PRD completion can reach Firstmate directly from its native report.
  // The ordinary watcher still handles supervision and uncorrelated reports.
  const attemptedPrdRelays = new Map<string, number>();
  let checkingPrd = false;
  let closing = false;
  const prdTimer = setInterval(async () => {
    const home = paths.fmHome;
    if (closing || checkingPrd || !primary.agentFor(home)) return;
    checkingPrd = true;
    const getRequests = () => (work.store.snapshot() as {
      requests: { ref: string; status: string; updatedAt: string }[];
    }).requests;
    try {
      const now = Date.now();
      for (const [ref, at] of attemptedPrdRelays) {
        if (now - at > 10 * 60_000) attemptedPrdRelays.delete(ref);
      }
      const report = await findPrdReport(home, getRequests(), new Set(attemptedPrdRelays.keys()), now);
      if (!report || closing) return;
      const isPending = () => getRequests().some((request) =>
        request.ref === report.ref && (request.status === "sent" || request.status === "working"),
      );
      if (!isPending()) return;
      let filed: string[] = [];
      try {
        filed = await registerCrewDocuments(home, report);
        if (filed.length) {
          for (const ws of wss.clients) send(ws, { event: "work.updated" });
        }
      } catch (error) {
        // Filing is best effort: the report still reaches the captain below.
        input.logger.warn({ err: error }, "Amun could not file PRD's documents");
      }
      const safeReport = { ...report, text: work.redactor.text(report.text) };
      const agentId = primary.agentFor(home);
      if (!agentId) return;
      if (report.forwardVerbatim) {
        // The renderer has saved the dispatch acknowledgement when this
        // request is working. Its result can now arrive during a wake.
        if (primary.pending(home) && !getRequests().some((request) =>
          request.ref === report.ref && request.status === "working",
        )) return;
        attemptedPrdRelays.set(report.ref, now);
        showUnprompted({ fmHome: home, agentId, text: forwardPrdReport(safeReport) }, true);
        return;
      }
      const space = (await spaces.list())[0];
      if (!space || closing || primary.pending(home) || !isPending()) return;
      attemptedPrdRelays.set(report.ref, now);
      const { reply, followups } = await primary.send(space, prdRelayPrompt(safeReport, filed), true);
      if (closing) return;
      if (isPrdRelayReply(reply, report.ref) && isPending()) {
        showUnprompted({ fmHome: home, agentId, text: reply }, true);
      }
      for (const text of followups ?? []) showUnprompted({ fmHome: home, agentId, text });
    } catch (error) {
      input.logger.warn({ err: error }, "Amun PRD report relay failed");
    } finally {
      checkingPrd = false;
    }
  }, 1_000);
  prdTimer.unref();

  const stopBlockerChecks = scheduleBlockerChecks(async () => {
    if (await ado.refreshLinkedBlockers(async (slug, prompt) => (await primary.send(await spaces.get(slug), prompt)).reply)) {
      for (const ws of wss.clients) send(ws, { event: "work.updated" });
    }
  }, (error) => input.logger.warn({ err: error }, "Amun blocker refresh failed"));
  // Chair questions reach the captain as attention items, and answers go
  // back; connected UIs are told when that (or a finished council) shows.
  let councilPolling = false;
  const councilTimer = setInterval(() => {
    if (councilPolling) return;
    councilPolling = true;
    void council
      .poll()
      .then((changed) => {
        if (!changed) return;
        const event: AmunEvent = { event: "work.updated" };
        for (const ws of wss.clients) send(ws, event);
      })
      .catch((error: unknown) => input.logger.warn({ err: error }, "amun council poll failed"))
      .finally(() => {
        councilPolling = false;
      });
  }, COUNCIL_POLL_MS);
  councilTimer.unref();
  // Weekly, validated, automatic; the previous version is kept for going back.
  const checkCouncilUpdate = () => void council.checkUpdate().catch(() => undefined);
  const councilFirstCheck = setTimeout(checkCouncilUpdate, 60_000);
  councilFirstCheck.unref();
  const councilUpdateTimer = setInterval(checkCouncilUpdate, COUNCIL_UPDATE_CHECK_MS);
  councilUpdateTimer.unref();

  input.logger.info(
    { path: AMUN_WS_PATH, fmHome: paths.fmHome, firstmateRoot: paths.firstmateRoot },
    "Amun RPC mounted",
  );
  return {
    handler,
    close() {
      closing = true;
      clearInterval(prdTimer);
      laterReplies.current = null;
      stopWatchingTurns();
      clearInterval(timer);
      stopBlockerChecks();
      clearInterval(councilTimer);
      clearInterval(councilUpdateTimer);
      clearTimeout(councilFirstCheck);
      council.stop();
      notionForFirstMate?.close();
      notion.stop();
      trackersForFirstMate?.close();
      trackers.stop();
      void previews.closeAll();
      work.close();
      input.httpServer.off("upgrade", onUpgrade);
      for (const ws of wss.clients) ws.close();
      wss.close();
    },
  };
}
