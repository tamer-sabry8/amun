import {
  amunRequestSchema,
  type AmunRequest,
  type AmunResponse,
  type FleetSnapshot,
} from "@getpaseo/protocol/amun-rpc";
import { boardColumnFor, holdAnswerPrompt, holdsFromSnapshot } from "./firstmate-cli.js";
import { PmStore } from "./pm-store.js";
import type { AdoServiceLike, Redactor, WorkspaceLike, WorkStoreLike } from "@amun/work-store";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildTraceBundle } from "./trace/trace-bundle.js";
import type { TraceLog } from "./trace/trace-log.js";
import type { ConnectionStore } from "./connections/connection-store.js";
import type { PrimarySessions } from "./primary-session.js";
import type { ProductSpaceStore } from "./product-spaces.js";

export interface AmunRpcDeps {
  spaces: ProductSpaceStore;
  primary: PrimarySessions;
  connections: ConnectionStore;
  work: WorkStoreLike;
  workspace: WorkspaceLike;
  ado: AdoServiceLike;
  amunHome: string;
  firstmateRoot: string;
  readSnapshot: (fmHome: string) => Promise<FleetSnapshot>;
  /** Read-only tail of a crewmate's session (fm-peek.sh). */
  peekCrew?: (fmHome: string, taskId: string) => Promise<string>;
  trace: TraceLog;
  redactor: Redactor;
  /** The Paseo daemon log, included in trace bundles when known. */
  daemonLog?: string | null;
  /** The captain's Firstmate home (one for every product). */
  fmHome: string;
}

/** Methods polled every few seconds; traced only when they fail. */
const QUIET = new Set([
  "spaces.list",
  "fleet.snapshot",
  "holds.list",
  "crew.peek",
  "work.snapshot",
  "workspace.snapshot",
  "connections.list",
]);

/** Sent once, in the captain's name, so the First Mate keeps agent history. */
export const HISTORY_REQUEST =
  "The captain asked Amun to keep agent history for troubleshooting. Please turn on " +
  "Firstmate's fleet ledger (config/fleet-ledger, see docs/fleet-ledger.md) and the task " +
  "status archive (config/status-archive, see docs/configuration.md) in this home, if they " +
  "are not on already. Amun only reads them.";

function describeParams(request: AmunRequest): Record<string, unknown> {
  const { id: _id, method: _method, ...params } = request;
  if ("secret" in params) return { ...params, secret: "[REDACTED]" };
  return params;
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.name !== "Error" ? error.name : "InternalError";
}

/** Transport-free dispatcher so the same handler serves WebSocket and tests. */
export class AmunRpcHandler {
  constructor(private readonly deps: AmunRpcDeps) {}

  async handleRaw(raw: unknown): Promise<AmunResponse> {
    const parsed = amunRequestSchema.safeParse(raw);
    const id =
      typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string"
        ? raw.id
        : "unknown";
    if (!parsed.success) {
      return { id, ok: false, error: { code: "InvalidRequest", message: parsed.error.message } };
    }
    const started = Date.now();
    try {
      const result = await this.handle(parsed.data);
      this.traceCall(parsed.data, Date.now() - started, null, result);
      return { id, ok: true, result };
    } catch (error) {
      const failure = {
        code: errorCode(error),
        message: error instanceof Error ? error.message : String(error),
      };
      this.traceCall(parsed.data, Date.now() - started, failure, null);
      return { id, ok: false, error: failure };
    }
  }

  /** One line per call; chats also record who said what to whom. */
  private traceCall(
    request: AmunRequest,
    ms: number,
    error: { code: string; message: string } | null,
    result: unknown,
  ): void {
    const { trace } = this.deps;
    if (!error && QUIET.has(request.method)) return;
    trace.record({
      source: "amun-rpc",
      kind: error ? "call-failed" : "call",
      method: request.method,
      ms,
      ...(error ? { error } : {}),
      params: request.method === "trace.export" ? {} : describeParams(request),
    });
    if (request.method === "primary.send" || request.method === "holds.answer") {
      const text = request.method === "primary.send" ? request.text : request.answer;
      trace.record({ source: "chat", kind: "message", from: "captain", to: "first-mate", text });
      const reply =
        typeof result === "object" && result !== null && "reply" in result ? result.reply : null;
      if (typeof reply === "string")
        trace.record({ source: "chat", kind: "message", from: "first-mate", to: "captain", text: reply });
    }
    if (request.method === "work.command" && request.command.action === "message")
      trace.record({
        source: "chat",
        kind: "message",
        from: request.command.role === "user" ? "captain" : String(request.command.role ?? "unknown"),
        area: request.command.workAreaId ?? null,
        text: request.command.text ?? "",
      });
  }

  private async exportTrace(): Promise<unknown> {
    const bundle = await buildTraceBundle({
      amunHome: this.deps.amunHome,
      fmHome: this.deps.fmHome,
      traceDir: this.deps.trace.dir,
      redactor: this.deps.redactor,
      daemonLog: this.deps.daemonLog ?? null,
    });
    return {
      fileName: bundle.fileName,
      path: bundle.path,
      size: bundle.bytes.length,
      files: bundle.files,
      skipped: bundle.skipped,
      base64: Buffer.from(bundle.bytes).toString("base64"),
    };
  }

  /** Asks the First Mate once; Amun never writes the flags itself. */
  private async askForHistory(slug: string): Promise<unknown> {
    const space = await this.deps.spaces.get(slug);
    const config = path.join(space.fmHome, "config");
    const ledger = existsSync(path.join(config, "fleet-ledger"));
    const archive = existsSync(path.join(config, "status-archive"));
    const marker = path.join(this.deps.amunHome, "history-requested.json");
    const already = existsSync(marker)
      ? (JSON.parse(readFileSync(marker, "utf8")) as { fmHome?: string }).fmHome === space.fmHome
      : false;
    if ((ledger && archive) || already) return { asked: false, ledger, archive };
    await this.deps.primary.send(space, HISTORY_REQUEST);
    writeFileSync(marker, JSON.stringify({ fmHome: space.fmHome, at: new Date().toISOString() }));
    this.deps.trace.record({ source: "chat", kind: "message", from: "amun", to: "first-mate", text: HISTORY_REQUEST });
    return { asked: true, ledger, archive };
  }

  private async withStore<T>(slug: string, use: (store: PmStore) => T): Promise<T> {
    const space = await this.deps.spaces.get(slug);
    const store = PmStore.forHome(space.fmHome, this.deps.amunHome);
    try {
      return use(store);
    } finally {
      store.close();
    }
  }

  private async snapshot(slug: string): Promise<FleetSnapshot> {
    const space = await this.deps.spaces.get(slug);
    return this.deps.readSnapshot(space.fmHome);
  }

  async handle(request: AmunRequest): Promise<unknown> {
    switch (request.method) {
      case "spaces.list":
        return this.deps.spaces.list();
      case "spaces.create":
        return this.deps.spaces.create({
          name: request.name,
          ...(request.slug ? { slug: request.slug } : {}),
          ...(request.harness ? { harness: request.harness } : {}),
        });
      case "fleet.snapshot":
        return this.snapshot(request.space);
      case "holds.list":
        return holdsFromSnapshot(await this.snapshot(request.space));
      case "crew.peek": {
        const space = await this.deps.spaces.get(request.space);
        if (!this.deps.peekCrew) return { live: false, text: "" };
        try {
          const text = await this.deps.peekCrew(space.fmHome, request.taskId);
          return { live: true, text: this.deps.redactor.text(text).slice(-32_768) };
        } catch {
          return { live: false, text: "" };
        }
      }
      case "backlog.list": {
        const snapshot = await this.snapshot(request.space);
        return snapshot.backlog.records
          .filter((record) => record.structured !== false && record.id)
          .map((record) => ({ ...record, column: boardColumnFor(record) }));
      }
      case "board.get": {
        const snapshot = await this.snapshot(request.space);
        return this.withStore(request.space, (store) => {
          store.projectBacklog(snapshot.backlog.records);
          return store.board();
        });
      }
      case "initiatives.list":
        return this.withStore(request.space, (store) =>
          store.listInitiatives().map((i) => ({ ...i, missing: PmStore.missingQuestions(i) })),
        );
      case "initiative.upsert": {
        const { initiative } = request;
        return this.withStore(request.space, (store) => {
          const saved = store.upsertInitiative({
            id: initiative.id,
            title: initiative.title,
            ...(initiative.what !== undefined ? { what: initiative.what } : {}),
            ...(initiative.why !== undefined ? { why: initiative.why } : {}),
            ...(initiative.when !== undefined ? { when: initiative.when } : {}),
            ...(initiative.cost !== undefined ? { cost: initiative.cost } : {}),
            ...(initiative.status ? { status: initiative.status } : {}),
            ...(initiative.roadmapId ? { roadmapId: initiative.roadmapId } : {}),
          });
          return { ...saved, missing: PmStore.missingQuestions(saved) };
        });
      }
      case "holds.answer": {
        const space = await this.deps.spaces.get(request.space);
        return this.deps.primary.send(space, holdAnswerPrompt(request.hold, request.answer));
      }
      case "primary.start": {
        const space = await this.deps.spaces.get(request.space);
        return this.deps.primary.start(space, request.harness);
      }
      case "primary.send": {
        const space = await this.deps.spaces.get(request.space);
        return this.deps.primary.send(space, request.text);
      }
      case "connections.list":
        return this.deps.connections.list();
      case "connections.save":
        return this.deps.connections.save(request.connection, request.secret);
      case "connections.check":
        return this.deps.connections.check(request.connection);
      case "connections.forget":
        await this.deps.connections.forget(request.connection);
        return this.deps.connections.list();
      case "work.snapshot":
        return this.deps.work.snapshot();
      case "work.command":
        return this.deps.work.handle({ ...request.command, version: 1, kind: "work" });
      case "workspace.snapshot":
        return this.deps.workspace.snapshot();
      case "workspace.command":
        return this.deps.workspace.handle({ ...request.command, version: 1, kind: "workspace" }) ?? null;
      case "ado.request":
        return this.deps.ado.handle(request.message);
      case "trace.export":
        return this.exportTrace();
      case "trace.history":
        return this.askForHistory(request.space);
    }
  }
}
