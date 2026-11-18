import {
  amunRequestSchema,
  type AmunRequest,
  type AmunResponse,
  type FleetSnapshot,
} from "@getpaseo/protocol/amun-rpc";
import { boardColumnFor, holdAnswerPrompt, holdsFromSnapshot } from "./firstmate-cli.js";
import type { PrimarySessions } from "./primary-session.js";
import type { ProductSpaceStore } from "./product-spaces.js";

export interface AmunRpcDeps {
  spaces: ProductSpaceStore;
  primary: PrimarySessions;
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
    }
  }
}
