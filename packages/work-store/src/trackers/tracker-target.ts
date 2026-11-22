// Linear and Jira as destinations of an approved plan (plan-publication.ts).
// The publisher already binds the captain's approval to the exact items,
// gives each item one marker, records "sent" before a request leaves, looks
// an uncertain write up by its marker before sending anything again, and
// retries a confirmed-missing item once under the same approval. This file
// adds what each provider needs: the destination check, parent and sprint
// links from earlier items' receipts, and read-back of what was created.
import type { Database } from "../sqlite.ts";
import {
  PlanBlocked,
  PlanRefused,
  type PlanReceipt,
  type PlanScope,
  type PlanTarget,
  type PlanWriteItem,
} from "../plan-publication.ts";
import { JiraWriter, jiraSite } from "./jira-target.ts";
import { LinearWriter, linearParent } from "./linear-target.ts";
import {
  obj,
  text,
  toolData,
  trackerStep,
  type TrackerId,
  type TrackerSession,
  type TrackerStep,
  type Wait,
} from "./tracker-items.ts";

export interface TrackerAccess {
  /** True when a grant is saved for the provider. */
  configured(provider: TrackerId): Promise<boolean>;
  /** One MCP session with a current grant. */
  use<T>(
    provider: TrackerId,
    work: (session: TrackerSession) => Promise<T>,
  ): Promise<T>;
}

export const TRACKER_DESTINATIONS = new Set<string>(["linear", "jira"]);
const label = { linear: "Linear", jira: "Jira" } as const;

/**
 * The plans one proposal became when the captain approved only some of its
 * items (work_plans.split_from): the original and every split of it, with
 * the plan being published first. Unrelated plans are never included.
 */
function splitFamily(db: Database, planId: string): string[] {
  const parent = db.prepare("SELECT split_from FROM work_plans WHERE id=?");
  let root = planId;
  for (const seen = new Set([planId]); ;) {
    const up = (parent.get(root) as { split_from: string | null } | undefined)
      ?.split_from;
    if (!up || seen.has(up)) break;
    seen.add(up);
    root = up;
  }
  const children = db.prepare("SELECT id FROM work_plans WHERE split_from=?");
  const family = new Set([root]);
  for (const queue = [root]; queue.length;)
    for (const row of children.all(queue.shift()!) as { id: string }[])
      if (!family.has(row.id)) {
        family.add(row.id);
        queue.push(row.id);
      }
  return [planId, ...[...family].filter((id) => id !== planId)];
}

/**
 * A reference to another item of the same plan, or of a split of it (by its
 * id, or by its exact title, which is how Firstmate names it), becomes that
 * item's receipt. Anything else is taken as an existing key in the tracker.
 */
function reference(
  db: Database,
  planId: string,
  provider: TrackerId,
  value: string | null,
) {
  if (!value) return null;
  const same = (a: string) => a.normalize("NFKC").trim().toLowerCase();
  const read = db.prepare(
    "SELECT approved_json,items_json FROM work_plans WHERE id=?",
  );
  for (const id of splitFamily(db, planId)) {
    const plan = read.get(id) as
      { approved_json: string | null; items_json: string | null } | undefined;
    const items = JSON.parse(
      plan?.approved_json ?? plan?.items_json ?? "[]",
    ) as {
      id: string;
      summary: string;
      fields: Record<string, string | number | null>;
    }[];
    const named = items.filter(
      (item) =>
        item.id === value ||
        same(item.summary) === same(value) ||
        (typeof item.fields.title === "string" &&
          same(item.fields.title) === same(value)),
    );
    if (named.length > 1)
      throw new PlanRefused(
        `${label[provider]} refused it: more than one item in this plan is called ${value}, so its parent or sprint is unclear`,
      );
    if (!named.length) continue;
    const row = db
      .prepare(
        "SELECT state,external_id FROM plan_writes WHERE plan_id=? AND item_id=?",
      )
      .get(id, named[0]!.id) as
      { state: string; external_id: string | null } | undefined;
    if (row?.state === "created" && row.external_id) return row.external_id;
    throw new PlanRefused(
      id === planId
        ? `${label[provider]} refused it: the item it belongs to (${named[0]!.summary}) was not created, so nothing was sent`
        : `${label[provider]} refused it: the item it belongs to (${named[0]!.summary}) is in the other part of this plan and has not been created yet. Approve and publish it first, then retry`,
    );
  }
  return value;
}

export async function jiraSites(session: TrackerSession) {
  const result = await session.call("getAccessibleAtlassianResources", {});
  if (result.isError) throw Error("Jira sites unavailable");
  const resources = obj(obj(toolData(result)).data).resources;
  return (Array.isArray(resources) ? resources : []).map(obj).map((site) => ({
    id: String(site.cloudId ?? site.id ?? ""),
    url: text(site.url),
  }));
}

/** The Linear workspace URL key the grant is in. */
async function linearWorkspace(session: TrackerSession) {
  const result = await session.call("get_workspace", {});
  if (result.isError) throw Error("Linear workspace unavailable");
  const workspace = obj(toolData(result));
  const url = text(workspace.url) ?? "";
  return (
    text(workspace.urlKey) ??
    url.replace(/^https:\/\/linear\.app\//, "").replace(/\/.*$/, "")
  ).toLowerCase();
}

export function trackerPlanTarget(
  provider: TrackerId,
  db: Database,
  scope: PlanScope,
  access: TrackerAccess,
  wait?: Wait,
): PlanTarget {
  const links = (step: TrackerStep) => ({
    parent: reference(db, scope.planId, provider, step.parent),
    sprint: reference(db, scope.planId, provider, step.sprint),
  });
  const run = async (
    item: PlanWriteItem,
    mode: "write" | "find",
  ): Promise<PlanReceipt | undefined> => {
    const step = trackerStep(provider, item);
    const { parent, sprint } = links(step);
    return access.use(provider, async (session) => {
      if (provider === "jira") {
        const jira = new JiraWriter(
          session,
          jiraSite(await jiraSites(session), step.site),
          wait,
        );
        if (step.kind === "sprint")
          return mode === "write"
            ? jira.createSprint(step)
            : jira.findSprint(step);
        if (step.kind === "epic" && parent)
          throw new PlanRefused(
            "Jira refused it: an epic cannot have a parent here",
          );
        return mode === "write"
          ? jira.createIssue(step, parent, sprint)
          : jira.findIssue(step, parent, sprint);
      }
      const workspace = await linearWorkspace(session);
      if (workspace !== step.site)
        throw new PlanRefused(
          `Linear refused it: this connection is in workspace ${workspace}, not ${step.site}. Reconnect Linear with that workspace`,
        );
      const linear = new LinearWriter(session, wait);
      const team = await linear.team(step.team!);
      const owner = step.kind === "epic" ? null : linearParent(parent);
      const cycle =
        sprint && step.kind !== "epic"
          ? await linear.cycle(team.id, sprint)
          : null;
      if (mode === "find") return linear.find(step, team.key, owner, cycle);
      return step.kind === "epic"
        ? linear.createEpic(step, team.key)
        : linear.createIssue(step, team.key, owner, cycle);
    });
  };
  return {
    async write(item) {
      const receipt = await run(item, "write");
      if (!receipt) throw Error(`${label[provider]} did not confirm the write`);
      return receipt;
    },
    find: (item) => run(item, "find"),
  };
}

/** The publisher's resolver for Linear and Jira plans. */
export function trackerResolver(
  db: Database,
  access: TrackerAccess,
  wait?: Wait,
) {
  return async (destination: string, scope: PlanScope): Promise<PlanTarget> => {
    if (destination !== "linear" && destination !== "jira")
      throw new PlanBlocked("Amun cannot publish to this destination.");
    if (!(await access.configured(destination)))
      throw new PlanBlocked(
        `Connect ${label[destination]} in Settings, then retry. Nothing was sent.`,
      );
    return trackerPlanTarget(destination, db, scope, access, wait);
  };
}
