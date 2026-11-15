// Publishes an approved plan (work_plans) to its destinations and reports
// each item back through the store's own "record-results" command.
//
// One approval covers exactly the approved items. Each item gets one stable
// marker, so a write whose outcome is uncertain is looked up before anything
// is sent again: found → linked, confirmed missing → retried once under the
// same approval, still uncertain → reported as "unknown" for the owner.
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { adoParentOf, adoWorkItemOf } from "../../domain/src/ado-update.ts";

export interface PlanWriteItem {
  id: string;
  summary: string;
  fields: Record<string, string | number | null>;
  /** Stable per item for the life of the plan; written with the item. */
  marker: string;
  destination: string;
}
export interface PlanReceipt {
  externalId: string;
  url?: string | undefined;
  /** Said when the item was created differently from the plan. */
  note?: string | undefined;
  /** The item already existed, so it was linked and nothing was created. */
  linked?: boolean | undefined;
  /** An existing page was changed; nothing new was created. */
  updated?: boolean | undefined;
  /** What a written page looked like afterwards, for a later conflict check. */
  version?: string | undefined;
  /** The Notion parent a created page was written under. */
  parentId?: string | undefined;
}
export interface PlanTarget {
  /** Creates the item. Throws when the outcome is a failure or uncertain. */
  write(item: PlanWriteItem): Promise<PlanReceipt>;
  /**
   * Looks the item up by its marker. `undefined` means the destination
   * confirmed it is absent; a throw means that could not be established.
   */
  find(item: PlanWriteItem): Promise<PlanReceipt | undefined>;
  /**
   * Read-only: an item Amun created earlier with the same title and type in
   * this destination, under any plan. A throw means that could not be
   * established.
   */
  existing?(item: PlanWriteItem): Promise<PlanReceipt | undefined>;
}
export interface PlanScope {
  planId: string;
  groupId: string | null;
  workAreaId: string | null;
}
/** Throws `PlanBlocked` with a plain reason when nothing can be sent. */
export type ResolveTarget = (
  destination: string,
  scope: PlanScope,
) => Promise<PlanTarget>;
/** The destination cannot be written to at all; nothing was sent. */
export class PlanBlocked extends Error {}
/** Thrown by `write` when the request provably never left the Mac. */
export class PlanNotSent extends Error {}
/**
 * The destination answered and refused: nothing was created, so the item is
 * recorded as not created with its reason and never looked up or retried.
 */
export class PlanRefused extends PlanNotSent {}
/** An update stopped because the page changed since Amun wrote it. */
export class PlanChanged extends PlanNotSent {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
  }
}

/** Safe, plain words for why the already-exists check could not finish. */
export function duplicateCheckReason(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const rejected = /request_rejected_(\d{3})/.exec(text);
  if (error instanceof Error && error.name === "AdoTypeMissing")
    return "Azure DevOps does not have that work item type in this project";
  if (rejected) {
    const status = Number(rejected[1]);
    if (status === 401 || status === 403)
      return `Azure DevOps answered ${status}; check the connection and permissions`;
    if (status === 404)
      return "Azure DevOps answered 404; check the project name";
    return `Azure DevOps answered ${status} to the search`;
  }
  if (/identity mismatch/i.test(text))
    return "an item found there belongs to a different project";
  if (/ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|network|timed? ?out/i.test(text))
    return "Azure DevOps could not be reached";
  return "";
}
const trackerWords: Record<string, string> = {
  notion: "Notion",
  ado: "Azure DevOps",
  github: "GitHub",
};
/** The destination's own redacted refusal text, when the error carries one. */
function refusalDetail(error: unknown) {
  const detail = (error as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" ? detail.trim().slice(0, 300) : "";
}
/**
 * Plain words for why a destination turned a write down, from its raw error.
 * The raw text is never shown: only the matched category is.
 */
export function refusalReason(destination: string, error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const detail = refusalDetail(error);
  if (detail)
    return `${trackerWords[destination] ?? "The destination"} refused it: ${detail}`;
  const name = trackerWords[destination] ?? "The destination";
  const status = Number(
    /request_rejected_(\d{3})|\b(?:status|http|error)\D{0,3}(\d{3})\b|\b(4\d\d|5\d\d)\b/i
      .exec(text)
      ?.slice(1)
      .find(Boolean) ?? 0,
  );
  const thing = destination === "notion" ? "the page" : "the item";
  if (/did not confirm|has not confirmed|not confirmed/i.test(text))
    return `${name} did not confirm whether this went through. Amun checks before sending anything again.`;
  if (
    status === 401 ||
    /unauthori[sz]ed|invalid[_ ]token|expired|reconnect/i.test(text)
  )
    return `Reconnect ${name} in Settings, then retry.`;
  if (
    status === 403 ||
    /forbidden|permission|restricted|not allowed|locked|read[- ]only|access denied/i.test(
      text,
    )
  )
    return `${name} refused the change: ${thing} can't be edited by this connection.`;
  if (status === 404 || /not[_ ]found|does not exist|no such/i.test(text))
    return `${name} refused the change: it could not find ${thing}.`;
  if (status === 409 || status === 412 || /conflict/i.test(text))
    return `${name} refused the change: ${thing} was changed by someone else.`;
  if (status === 429 || /rate.?limit|too many/i.test(text))
    return `${name} is busy right now. Try again in a minute.`;
  if (
    status >= 500 ||
    /ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|network|timed? ?out|unavailable/i.test(
      text,
    )
  )
    return `${name} could not be reached or had a problem. Try again shortly.`;
  if (status === 400 || /validation|invalid|malformed|unsupported/i.test(text))
    return `${name} refused the change: it did not accept the content.`;
  return `${name} refused the change.`;
}
/** An error line for the service log with links and secrets removed. */
export function redactedError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const detail = refusalDetail(error);
  return (detail ? `${text}: ${detail}` : text)
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/(bearer|basic|token|pat|password)[\s:=]+\S+/gi, "$1 [removed]")
    .slice(0, 400);
}

type WriteState = "pending" | "sent" | "created" | "missing" | "unknown";
interface WriteRow {
  item_id: string;
  marker: string;
  destination: string;
  state: WriteState;
  external_id: string | null;
  url: string | null;
  attempts: number;
  note: string | null;
  page_version: string | null;
  page_parent: string | null;
}
interface Records {
  handle(input: unknown): unknown[];
}
type Result = {
  id: string;
  state: "created" | "failed" | "unknown";
  externalId?: string;
  url?: string;
  linked?: boolean;
  updated?: boolean;
};
const same = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
    : "";
/**
 * The title, type and parent a planned item would be created with,
 * normalised. A parent is the existing work item's number, or "" for none.
 */
export function planItemKey(item: {
  summary: string;
  fields: Record<string, string | number | null>;
}) {
  const own = item.fields.title;
  const type = item.fields.type ?? item.fields["Work item type"];
  return {
    title: same(typeof own === "string" && own.trim() ? own : item.summary),
    type: same(type),
    parent: String(adoParentOf(item.fields).id ?? ""),
  };
}
/** Same title, same kind and the same parent: a link, never a create. */
export const sameItem = (
  a: ReturnType<typeof planItemKey>,
  b: ReturnType<typeof planItemKey>,
) => a.title === b.title && sameKind(a.type, b.type) && a.parent === b.parent;
// Azure DevOps projects name their stories differently (Agile, Scrum, CMMI,
// Basic), and a story is created under the project's own name when the
// requested one is missing, so all of them count as the same kind of item.
const storyFamily = new Set([
  "user story",
  "product backlog item",
  "requirement",
  "issue",
  "story",
  "backlog item",
]);
export const sameKind = (a: string, b: string) =>
  !a || !b || a === b || (storyFamily.has(a) && storyFamily.has(b));
/** One first attempt and one retry of an item confirmed missing. */
export const planWriteBudget = 2;

export class PlanPublisher {
  private readonly running = new Map<string, Promise<unknown[]>>();
  constructor(
    private readonly db: Database.Database,
    private readonly records: Records,
    private readonly resolve: ResolveTarget,
  ) {}

  /** Plans with a write that was sent and never confirmed (e.g. after a crash). */
  uncertain(): string[] {
    return (
      this.db
        .prepare(
          "SELECT DISTINCT w.plan_id AS id FROM plan_writes w JOIN work_plans p ON p.id=w.plan_id WHERE w.state IN ('sent','unknown') AND p.state IN ('approved','partial','failed')",
        )
        .all() as { id: string }[]
    ).map((row) => row.id);
  }

  /** What was written for a plan, for display and audit. */
  writes(planId: string) {
    return (
      this.db
        .prepare("SELECT * FROM plan_writes WHERE plan_id=? ORDER BY rowid")
        .all(planId) as WriteRow[]
    ).map((row) => ({
      id: row.item_id,
      destination: row.destination,
      state: row.state,
      externalId: row.external_id,
      url: row.url,
      attempts: row.attempts,
      note: row.note,
    }));
  }

  /**
   * Publishes or continues publishing one approved plan. With
   * `reconcileOnly`, nothing new is sent: uncertain writes are looked up and
   * linked if found.
   */
  publish(
    planId: string,
    options: { reconcileOnly?: boolean; retryFailed?: boolean } = {},
  ) {
    const active = this.running.get(planId);
    if (active) return active;
    const run = this.run(
      planId,
      options.reconcileOnly === true,
      options.retryFailed === true,
    ).finally(() => this.running.delete(planId));
    this.running.set(planId, run);
    return run;
  }

  /**
   * True when the plan is no longer an approval that can be continued, for
   * example because its items were edited after approval. Retrying it then
   * means a new review, never a quiet resend.
   */
  needsReview(planId: string) {
    const plan = this.db
      .prepare("SELECT state,approved_json FROM work_plans WHERE id=?")
      .get(planId) as
      { state: string; approved_json: string | null } | undefined;
    return (
      !plan ||
      !plan.approved_json ||
      !["approved", "partial", "failed"].includes(plan.state)
    );
  }

  /**
   * An item with the same title and type that Amun already created in this
   * destination: Amun's own receipts first, then a read-only look at the
   * destination. A blank type matches any, since both mean the project's own
   * story type.
   */
  async duplicate(
    planId: string,
    item: Omit<PlanWriteItem, "marker" | "destination">,
    destination: string,
    scope: PlanScope,
    target?: PlanTarget,
  ): Promise<PlanReceipt | undefined> {
    // An update names an item that already exists; it is never a duplicate.
    if (adoWorkItemOf(item.fields).named) return undefined;
    const key = planItemKey(item);
    const rows = this.db
      .prepare(
        `SELECT w.item_id,w.external_id,w.url,p.approved_json FROM plan_writes w JOIN work_plans p ON p.id=w.plan_id
         WHERE w.plan_id<>? AND w.destination=? AND w.state='created' AND w.external_id IS NOT NULL
         AND p.work_area_id IS ? ORDER BY p.created_at,w.rowid`,
      )
      .all(planId, destination, scope.workAreaId) as {
      item_id: string;
      external_id: string;
      url: string | null;
      approved_json: string | null;
    }[];
    for (const row of rows) {
      const before = (
        JSON.parse(row.approved_json ?? "[]") as (Parameters<
          typeof planItemKey
        >[0] & { id: string })[]
      ).find((entry) => entry.id === row.item_id);
      if (!before || adoWorkItemOf(before.fields).named) continue;
      const other = planItemKey(before);
      if (sameItem(other, key))
        return {
          externalId: row.external_id,
          ...(row.url ? { url: row.url } : {}),
          linked: true,
        };
    }
    if (!target?.existing) return undefined;
    const found = await target.existing({
      ...item,
      marker: "",
      destination,
    });
    return found ? { ...found, linked: true } : undefined;
  }

  /**
   * Before approval: the item this one would only link to, if any. Never
   * writes; a destination that cannot be read means only Amun's own receipts
   * are consulted.
   */
  async alreadyThere(
    planId: string,
    item: Omit<PlanWriteItem, "marker" | "destination">,
    destination: string,
  ) {
    const plan = this.db
      .prepare("SELECT group_id,work_area_id FROM work_plans WHERE id=?")
      .get(planId) as
      { group_id: string | null; work_area_id: string | null } | undefined;
    if (!plan || destination !== "ado") return undefined;
    const scope: PlanScope = {
      planId,
      groupId: plan.group_id,
      workAreaId: plan.work_area_id,
    };
    let target: PlanTarget | undefined;
    try {
      target = await this.resolve(destination, scope);
    } catch {
      target = undefined;
    }
    try {
      return await this.duplicate(planId, item, destination, scope, target);
    } catch {
      return undefined;
    }
  }

  /**
   * The latest thing Amun wrote to a Notion page it created, from its own
   * receipts: the plan item that wrote it, its marker, the version recorded
   * then and the title and body it was given. Undefined for any other page.
   */
  notionPage(pageId: string) {
    const bare = (value: string) => value.replaceAll("-", "").toLowerCase();
    const rows = this.db
      .prepare(
        `SELECT w.plan_id,w.item_id,w.marker,w.external_id,w.url,w.page_version,w.page_parent,p.approved_json
         FROM plan_writes w JOIN work_plans p ON p.id=w.plan_id
         WHERE w.destination='notion' AND w.state='created' AND w.external_id IS NOT NULL
         ORDER BY w.rowid DESC`,
      )
      .all() as {
      plan_id: string;
      item_id: string;
      marker: string;
      external_id: string;
      url: string | null;
      page_version: string | null;
      page_parent: string | null;
      approved_json: string | null;
    }[];
    const rowsOfPage = rows.filter(
      (row) => bare(row.external_id) === bare(pageId),
    );
    const latest = rowsOfPage[0];
    if (!latest) return undefined;
    // The marker belongs to the page, so it is the one its creation used.
    const marker = rowsOfPage.at(-1)!.marker;
    const item = (
      JSON.parse(latest.approved_json ?? "[]") as {
        id: string;
        summary: string;
        fields: Record<string, string | number | null>;
      }[]
    ).find((entry) => entry.id === latest.item_id);
    const field = (...names: string[]) => {
      for (const [key, value] of Object.entries(item?.fields ?? {}))
        if (
          names.includes(key.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
          typeof value === "string" &&
          value.trim()
        )
          return value.trim();
    };
    const title = field("title") ?? item?.summary ?? "";
    return {
      planId: latest.plan_id,
      itemId: latest.item_id,
      marker,
      version: latest.page_version,
      // The earliest write created the page, so its parent is the creation one.
      parentId: rowsOfPage.at(-1)!.page_parent,
      url: latest.url,
      title,
      body: field("body", "description") ?? title,
    };
  }

  private rows(planId: string) {
    return this.db
      .prepare("SELECT * FROM plan_writes WHERE plan_id=? ORDER BY rowid")
      .all(planId) as WriteRow[];
  }
  private set(
    planId: string,
    itemId: string,
    patch: Partial<Omit<WriteRow, "item_id" | "marker" | "destination">>,
  ) {
    const row = this.db
      .prepare("SELECT * FROM plan_writes WHERE plan_id=? AND item_id=?")
      .get(planId, itemId) as WriteRow;
    const next = { ...row, ...patch };
    this.db
      .prepare(
        "UPDATE plan_writes SET state=?,external_id=?,url=?,attempts=?,note=?,page_version=?,page_parent=? WHERE plan_id=? AND item_id=?",
      )
      .run(
        next.state,
        next.external_id,
        next.url,
        next.attempts,
        next.note,
        next.page_version,
        next.page_parent,
        planId,
        itemId,
      );
  }

  private async run(
    planId: string,
    reconcileOnly: boolean,
    retryFailed: boolean,
  ) {
    const plan = this.db
      .prepare(
        "SELECT group_id,work_area_id,destination,approved_json,results_json,state FROM work_plans WHERE id=?",
      )
      .get(planId) as
      | {
          group_id: string | null;
          work_area_id: string | null;
          destination: string;
          approved_json: string | null;
          results_json: string | null;
          state: string;
        }
      | undefined;
    if (
      !plan?.approved_json ||
      !["approved", "partial", "failed"].includes(plan.state)
    )
      return [];
    const items = JSON.parse(plan.approved_json) as Omit<
      PlanWriteItem,
      "marker" | "destination"
    >[];
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO plan_writes(plan_id,item_id,marker,destination,state,attempts) VALUES (?,?,?,?,'pending',0)",
    );
    this.db
      .transaction(() => {
        for (const item of items) {
          const own = item.fields.destination;
          insert.run(
            planId,
            item.id,
            randomUUID(),
            typeof own === "string" && own.trim()
              ? own.trim().toLowerCase()
              : plan.destination,
          );
        }
      })
      .immediate();
    // A retry covers only the items reported as not created. Their send
    // budget starts again, and an item that may have landed since is looked
    // up by its marker first, so it is linked rather than created twice.
    let only: Set<string> | null = null;
    if (retryFailed) {
      const failed = new Set(
        (
          JSON.parse(plan.results_json ?? "[]") as {
            id: string;
            state: string;
          }[]
        )
          .filter((result) => result.state === "failed")
          .map((result) => result.id),
      );
      only = failed;
      const reset = this.db.prepare(
        "UPDATE plan_writes SET attempts=0,note=NULL WHERE plan_id=? AND item_id=? AND state IN ('pending','missing')",
      );
      this.db
        .transaction(() => {
          for (const id of failed) reset.run(planId, id);
        })
        .immediate();
    }
    const scope: PlanScope = {
      planId,
      groupId: plan.group_id,
      workAreaId: plan.work_area_id,
    };
    const targets = new Map<string, Promise<PlanTarget>>();
    const target = (destination: string) => {
      let found = targets.get(destination);
      if (!found) {
        found = this.resolve(destination, scope);
        // A rejected lookup is reported per item below, not as unhandled.
        found.catch(() => undefined);
        targets.set(destination, found);
      }
      return found;
    };
    const results: Result[] = [];
    const done = (row: WriteRow, receipt: PlanReceipt) => {
      this.set(planId, row.item_id, {
        state: "created",
        external_id: receipt.externalId,
        url: receipt.url ?? null,
        note: receipt.note ?? null,
        page_version: receipt.version ?? null,
        // An update keeps the parent recorded when the page was created.
        page_parent: receipt.parentId ?? row.page_parent,
      });
      results.push({
        id: row.item_id,
        state: "created",
        externalId: receipt.externalId,
        ...(receipt.url ? { url: receipt.url } : {}),
        ...(receipt.linked ? { linked: true } : {}),
        ...(receipt.updated ? { updated: true } : {}),
      });
    };
    for (const row of this.rows(planId)) {
      const source = items.find((item) => item.id === row.item_id);
      if (!source || row.state === "created") continue;
      if (only && !only.has(row.item_id)) continue;
      // Reconciling never starts a write that was not already sent.
      if (reconcileOnly && row.state === "pending") continue;
      const item: PlanWriteItem = {
        ...source,
        marker: row.marker,
        destination: row.destination,
      };
      let api: PlanTarget;
      try {
        api = await target(row.destination);
      } catch (error) {
        // Nothing can be sent or looked up. A write already sent stays
        // uncertain; one never sent is simply not created.
        const sent = row.state === "sent" || row.state === "unknown";
        this.set(planId, row.item_id, {
          state: sent ? "unknown" : row.state,
          note:
            error instanceof PlanBlocked
              ? error.message
              : "The destination is unavailable.",
        });
        results.push({ id: row.item_id, state: sent ? "unknown" : "failed" });
        continue;
      }
      let state: WriteState = row.state;
      let attempts = row.attempts;
      let settled = false;
      // A retried item may have landed since it was reported missing.
      let lookFirst = only !== null && state === "missing";
      let checked = false;
      while (!settled) {
        if (state === "sent" || state === "unknown" || lookFirst) {
          lookFirst = false;
          // Look before sending anything again.
          let found: PlanReceipt | undefined;
          try {
            found = await api.find(item);
          } catch {
            this.set(planId, row.item_id, {
              state: "unknown",
              note: "Could not confirm whether this was created.",
            });
            results.push({ id: row.item_id, state: "unknown" });
            break;
          }
          if (found) {
            done(row, found);
            break;
          }
          state = "missing";
          this.set(planId, row.item_id, { state, note: null });
        }
        if (reconcileOnly || attempts >= planWriteBudget) {
          results.push({ id: row.item_id, state: "failed" });
          settled = true;
          break;
        }
        // An item that already exists is linked, never created a second
        // time, whichever way it got here: first publish, retry or recovery.
        if (row.destination === "ado" && !checked) {
          checked = true;
          try {
            const existing = await this.duplicate(
              planId,
              source,
              row.destination,
              scope,
              api,
            );
            if (existing) {
              done(row, {
                ...existing,
                note: `Already exists as #${existing.externalId}; linked, not created.`,
              });
              break;
            }
          } catch (error) {
            // The item itself does not fit the destination: say that, not
            // that the check could not run. Nothing was sent.
            if (error instanceof PlanNotSent) {
              this.set(planId, row.item_id, {
                note: error.message.slice(0, 300),
              });
              results.push({ id: row.item_id, state: "failed" });
              break;
            }
            const reason = duplicateCheckReason(error);
            console.error("plan duplicate check failed:", redactedError(error));
            this.set(planId, row.item_id, {
              note: `Could not check whether this already exists${reason ? ` (${reason})` : ""}, so nothing was created. Try again or ask Firstmate.`,
            });
            results.push({ id: row.item_id, state: "failed" });
            break;
          }
        }
        attempts += 1;
        state = "sent";
        // Recorded before the request leaves, so a crash is seen as uncertain.
        this.set(planId, row.item_id, { state, attempts });
        try {
          done(row, await api.write(item));
          settled = true;
        } catch (error) {
          console.error(
            "plan write failed:",
            row.destination,
            redactedError(error),
          );
          this.set(planId, row.item_id, {
            note:
              error instanceof PlanRefused
                ? error.message.slice(0, 400)
                : error instanceof PlanNotSent
                  ? error.message.slice(0, 300)
                  : refusalReason(row.destination, error),
            ...(error instanceof PlanChanged ? { url: error.url } : {}),
          });
          if (error instanceof PlanRefused) {
            this.set(planId, row.item_id, { state: "missing" });
            results.push({ id: row.item_id, state: "failed" });
            settled = true;
          } else if (error instanceof PlanNotSent) {
            // Nothing left the Mac, so there is nothing to look up.
            state = "missing";
            this.set(planId, row.item_id, { state });
          }
          // Otherwise the outcome is uncertain: loop back and look it up.
        }
      }
    }
    if (!results.length) return [];
    return this.records.handle({
      version: 1,
      kind: "work",
      action: "record-results",
      planId,
      results,
    });
  }
}
