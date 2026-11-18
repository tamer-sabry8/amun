import {
  amunRequestSchema,
  type AmunRequest,
  type AmunResponse,
  type FleetSnapshot,
} from "@getpaseo/protocol/amun-rpc";
import { boardColumnFor, holdAnswerPrompt, holdsFromSnapshot } from "./firstmate-cli.js";
import { PmStore } from "./pm-store.js";
import type { WorkStoreLike } from "@amun/work-store";
import type { ConnectionStore } from "./connections/connection-store.js";
import type { PrimarySessions } from "./primary-session.js";
import type { ProductSpaceStore } from "./product-spaces.js";

export interface AmunRpcDeps {
  spaces: ProductSpaceStore;
  primary: PrimarySessions;
  connections: ConnectionStore;
  work: WorkStoreLike;
  amunHome: string;
  firstmateRoot: string;
  readSnapshot: (fmHome: string) => Promise<FleetSnapshot>;
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
    try {
      return { id, ok: true, result: await this.handle(parsed.data) };
    } catch (error) {
      return {
        id,
        ok: false,
        error: { code: errorCode(error), message: error instanceof Error ? error.message : String(error) },
      };
    }
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
    }
  }
}
