import { reviewBlockerComments } from "./blocker-comment-review.ts";
import { observeSprintBlockers } from "./sprint-blocker-evidence.ts";
import { comparePrd } from "./prd-comparison.ts";
// Azure DevOps backlog reads and governed writes for a product, ported from
// Amun Beta 0.9's service (backlog-read and ado-operation messages). The
// token comes from the daemon's Keychain store and is registered with the
// redactor before any request, so it never reaches a message or log.
import { createHash, randomUUID } from "node:crypto";
import {
  adoOperation,
  backlogRead,
  type AdoOperation,
} from "../../contracts/src/backlog.ts";
import { BoardDiscovery } from "./ado-board-discovery.ts";
import { AdoWriteClient } from "./ado-governed-writes.ts";
import { runAdoOperation } from "./ado-operations.ts";
import { projectSource } from "./ado-project-source.ts";
import { fetchTransport } from "./ado-transport.ts";
import type { Redactor } from "./redaction.ts";
import type { Database } from "./sqlite.ts";
import type { WorkspaceService } from "./workspace-service.ts";

export interface AdoConnectionRef {
  kind: string;
  baseUrl: string;
}
export interface AdoAccess {
  /** Saved connections (addresses only). */
  connections(): Promise<AdoConnectionRef[]>;
  /** The token for a connection, from Keychain; null when none is saved. */
  secret(connection: AdoConnectionRef): Promise<string | null>;
  fetch?: typeof fetch;
}

export const NO_AZURE_PROJECT =
  "Connect an Azure DevOps project to this product first.";
const NO_TOKEN = "Connect the mapped Azure collection in Settings.";

function readFailure(raw: string): string {
  if (raw === "request_rejected_403")
    return "Azure denied read access to this board.";
  if (raw === "request_rejected_401")
    return "Azure sign-in expired. Check the connection in Settings.";
  if (raw === "unknown_team")
    return "I couldn’t find that team in this project.";
  if (raw === NO_TOKEN || raw === NO_AZURE_PROJECT) return raw;
  return "Unable to read the mapped Azure project. Check its URL, VPN and connection.";
}

import {
  applySprintMoves,
  inspectSprintSubmission,
  type FirstmateDispatch,
} from "./sprint-submission.ts";

export class AdoService {
  private last: { scope: string; reader: BoardDiscovery } | undefined;

  constructor(
    private readonly db: Database,
    private readonly workspace: WorkspaceService,
    private readonly access: AdoAccess,
    private readonly redactor: Redactor,
  ) {}

  async refreshLinkedBlockers(dispatch?: FirstmateDispatch) {
    const scopes = this.db
      .prepare(
        `SELECT DISTINCT a.id AS workAreaId,a.product_id AS productId,
      json_extract(b.sprint_link_json,'$.sourceId') AS sourceId,
      json_extract(b.sprint_link_json,'$.teamId') AS team,
      substr(json_extract(b.sprint_link_json,'$.sprintId'),5) AS sprint
      FROM work_blockers b JOIN work_areas a ON a.id=b.work_area_id
      WHERE b.resolved_at IS NULL AND a.status<>'deleted' AND a.product_id IS NOT NULL
      AND json_extract(b.sprint_link_json,'$.teamId') IS NOT NULL
      AND json_extract(b.sprint_link_json,'$.sprintId') LIKE 'ado:%'`,
      )
      .all() as {
      workAreaId: string;
      productId: string;
      sourceId: string;
      team: string;
      sprint: string;
    }[];
    for (const scope of scopes) {
      await this.handle(
        {
          version: 1,
          kind: "backlog-read",
          action: "sprint-items",
          requestId: randomUUID(),
          ...scope,
        },
        dispatch,
      );
    }
    return scopes.length > 0;
  }

  /** Answers a backlog-read or ado-operation message; null if it is neither. */
  async handle(
    message: unknown,
    dispatch?: FirstmateDispatch,
  ): Promise<Record<string, unknown> | null> {
    const kind =
      message && typeof message === "object" && "kind" in message
        ? (message as { kind: unknown }).kind
        : null;
    if (kind !== "backlog-read" && kind !== "ado-operation") return null;
    const parsed =
      kind === "ado-operation"
        ? adoOperation.safeParse(message)
        : backlogRead.safeParse(message);
    if (!parsed.success) return null;
    const request = parsed.data;
    const meta = {
      kind: "backlog-result",
      productId: request.productId,
      requestId: request.requestId,
    };
    try {
      return await this.run(request, meta, dispatch);
    } catch (error) {
      if (request.action === "sprint-items" && request.workAreaId)
        observeSprintBlockers(
          this.db,
          { ...request, workAreaId: request.workAreaId },
          null,
        );
      const raw = error instanceof Error ? error.message : "";
      if (request.kind === "ado-operation")
        return {
          ...meta,
          kind: "ado-operation-result",
          message:
            raw === "revision_conflict"
              ? "The Azure item changed. Your edits are retained. Reload its revision before saving."
              : this.redactor.text(raw || "Azure operation failed."),
        };
      return { ...meta, view: "error", message: readFailure(raw) };
    }
  }

  private async run(
    request: AdoOperation | ReturnType<typeof backlogRead.parse>,
    meta: { kind: string; productId: string; requestId: string },
    dispatch?: FirstmateDispatch,
  ): Promise<Record<string, unknown>> {
    const sources = this.workspace.productSources(request.productId);
    const source = sources.find(
      (s) => s.id === request.sourceId && s.kind === "ado",
    );
    if (!source?.reference) throw new Error(NO_AZURE_PROJECT);
    const { connection, collection, project } = projectSource(
      source.reference,
      await this.access.connections(),
    );
    const secret = await this.access.secret(connection);
    if (!secret) throw new Error(NO_TOKEN);
    this.redactor.register(secret);
    const scope = JSON.stringify([
      request.productId,
      source.id,
      collection,
      project,
      createHash("sha256").update(secret).digest("hex"),
    ]);
    const transport = () =>
      fetchTransport(collection, secret, this.access.fetch ?? fetch);
    if (this.last?.scope !== scope)
      this.last = {
        scope,
        reader: new BoardDiscovery(collection, project, transport()),
      };
    const d = this.last.reader;
    if (request.kind === "ado-operation") {
      const target = { collection, project, team: request.team };
      const client = new AdoWriteClient(collection, project, transport());
      const mapped = () =>
        this.workspace
          .productSources(request.productId)
          .some(
            (current) =>
              current.id === source.id &&
              current.kind === "ado" &&
              current.reference === source.reference,
          );
      if (request.action === "compare-prd") {
        if (!dispatch) throw Error("Firstmate is unavailable.");
        let receipt: string | undefined;
        try {
          const result = await comparePrd(
            this.db,
            request,
            d,
            async (space, prompt) => {
              if (receipt)
                return dispatch(
                  space,
                  prompt +
                    "\nContinuation of comparison " +
                    request.ref +
                    " for work area " +
                    request.workAreaId +
                    ".",
                );
              const origin = this.workspace.recordReviewPrompt(
                {
                  productId: request.productId,
                  objectiveId: request.objectiveId,
                  expectedVersion: request.versionNumber,
                },
                request.ref,
                { areaId: request.workAreaId, chatId: request.chatId },
                prompt,
              );
              receipt = origin.messageId;
              return dispatch(space, origin.prompt);
            },
            mapped,
          );
          if (receipt)
            this.workspace.finishStoryReview(
              request.ref,
              receipt,
              result.message,
              true,
            );
          return { ...meta, kind: "ado-operation-result", ...result };
        } catch (error) {
          if (receipt)
            this.workspace.finishStoryReview(
              request.ref,
              receipt,
              "Backlog comparison pending. Refresh to check the current scope.",
              false,
            );
          throw error;
        }
      }
      if (request.action === "inspect-sprint-submission")
        return {
          ...meta,
          kind: "ado-operation-result",
          ...(await inspectSprintSubmission(
            this.db,
            request,
            target,
            client,
            async (levelId) => {
              const level = (await d.levels(request.team)).find(
                (l) => l.id === levelId,
              );
              if (!level) throw Error("Selected backlog unavailable.");
              const settings = await d.boardSettings(request.team, level.name);
              return d.cards(request.team, levelId, settings.columnField);
            },
          )),
        };
      if (request.action === "apply-sprint-moves") {
        if (!dispatch) throw Error("Firstmate is unavailable.");
        return {
          ...meta,
          kind: "ado-operation-result",
          ...(await applySprintMoves(
            this.db,
            request,
            target,
            d,
            client,
            mapped,
            dispatch,
          )),
        };
      }
      return runAdoOperation(this.db, request, target, d, client, mapped, {
        workspace: this.workspace,
        dispatch,
      });
    }
    if (request.action === "schema")
      return { ...meta, view: "schema", schema: await d.processSchema() };
    if (request.action === "teams")
      return { ...meta, view: "teams", teams: await d.teams() };
    if (request.action === "sprints" || request.action === "sprint-items") {
      const wanted = request.team.toLowerCase();
      const team = (await d.teams()).find(
        (t) => t.id.toLowerCase() === wanted || t.name.toLowerCase() === wanted,
      );
      if (!team) throw new Error("unknown_team");
      if (request.action === "sprints")
        return {
          ...meta,
          view: "sprints",
          sourceId: source.id,
          team,
          sprints: await d.sprints(team.id),
        };
      const membership = await d.iterationItems(team.id, request.sprint);
      if (
        request.workAreaId &&
        this.workspace
          .productSources(request.productId)
          .some(
            (current) =>
              current.id === source.id &&
              current.reference === source.reference,
          )
      ) {
        observeSprintBlockers(
          this.db,
          { ...request, workAreaId: request.workAreaId },
          membership.items,
        );
        if (dispatch)
          await reviewBlockerComments(
            this.db,
            { ...request, workAreaId: request.workAreaId, team: team.id },
            membership.items,
            d,
            dispatch,
            (text) => this.redactor.text(text),
          ).catch(() => undefined);
      }
      return {
        ...meta,
        view: "sprint-items",
        sprint: request.sprint,
        ...membership,
      };
    }
    if (request.action === "options")
      return { ...meta, view: "options", levels: await d.levels(request.team) };
    const level = (await d.levels(request.team)).find(
      (x) => x.id === request.level,
    );
    if (!level) throw new Error("Unknown backlog level");
    const [settings, columns] = await Promise.all([
      d.boardSettings(request.team, level.name),
      d.columns(request.team, level.name),
    ]);
    const backlogIteration = request.details
      ? await d.backlogIteration(request.team).catch(() => null)
      : null;
    const cards = await d.cards(
      request.team,
      request.level,
      settings.columnField,
      request.details,
    );
    const [identities, transitions] = request.details
      ? await Promise.all([
          d.teamIdentities(request.team).catch(() => []),
          Promise.all(
            [...new Set(cards.map((c) => c.type))].map(
              async (type) =>
                [type, await d.transitions(type).catch(() => ({}))] as const,
            ),
          ).then((entries) => Object.fromEntries(entries)),
        ])
      : [[], {}];
    return {
      ...meta,
      view: "cards",
      columns,
      cards,
      ...(request.details ? { identities, transitions } : {}),
      ...(request.details
        ? {
            backlogIteration,
            creationTarget: await d
              .planningCreationTarget(
                request.team,
                request.level,
                backlogIteration,
              )
              .catch(() => null),
          }
        : {}),
      canEditBoard: settings.canEdit,
    };
  }
}
