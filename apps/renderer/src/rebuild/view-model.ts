// Pure derivations from the work snapshot for the rebuilt screens.
import type { WorkSnapshot } from "../../../../packages/contracts/src/work.ts";
import {
  attentionList,
  attentionRow,
  awaySummary,
  islandItem,
  rankWork,
  type Attention,
} from "../../../../packages/domain/src/work/home.ts";
import { approveLabel } from "../../../../packages/domain/src/work/permissions.ts";
import { needsLinking } from "../../../../packages/domain/src/work/model.ts";
import {
  conversionSuggestion,
  objectiveProgress,
  rfpCard,
} from "../../../../packages/domain/src/work/flows.ts";

export type Snapshot = WorkSnapshot;
export type Area = Snapshot["areas"][number];
export const typeLabels: Record<Area["type"], string> = {
  product: "Product",
  project: "Project",
  task: "Task",
  rfp: "RFP",
};

export const groupName = (snapshot: Snapshot, id: string | null) =>
  snapshot.groups.find((group) => group.id === id)?.name ?? null;
export const areaOf = (snapshot: Snapshot, id: string | null) =>
  snapshot.areas.find((area) => area.id === id) ?? null;

/** Group separation: the active group only, or everything when none is chosen yet. */
export function visibleGroups(snapshot: Snapshot): string[] | null {
  const active = snapshot.setup.activeGroupId;
  return active ? [active] : null;
}
const inScope = (snapshot: Snapshot, groupId: string | null) => {
  const groups = visibleGroups(snapshot);
  return groups === null || groupId === null || groups.includes(groupId);
};

export function attentionItems(snapshot: Snapshot): Attention[] {
  return snapshot.attention
    .filter((item) => inScope(snapshot, item.groupId))
    .map((item) => {
      const plan = item.ref?.startsWith("plan:")
        ? snapshot.plans.find((entry) => "plan:" + entry.id === item.ref)
        : undefined;
      return {
        id: item.id,
        kind: item.kind,
        groupName: groupName(snapshot, item.groupId),
        workAreaId: item.workAreaId,
        workAreaName: areaOf(snapshot, item.workAreaId)?.name ?? null,
        title: item.title,
        detail: item.detail,
        state: item.state,
        createdAt: item.createdAt,
        ...(plan && plan.state === "proposed"
          ? {
              batch: {
                count: plan.items.length,
                noun: plan.kind === "stories" ? "story" : "change",
                summary: plan.summary,
                items: plan.items.map((entry) => entry.summary),
              },
            }
          : {}),
      };
    });
}

export function homeModel(
  snapshot: Snapshot,
  now: number,
  /** The work whose chat is on screen, if one is. */
  openWorkAreaId: string | null = null,
) {
  const items = attentionItems(snapshot);
  const open = attentionList(items);
  const island = islandItem(items, openWorkAreaId);
  const areas = snapshot.areas.filter(
    (area) => inScope(snapshot, area.groupId) && area.status !== "archived",
  );
  const openByArea = new Map<string, number>();
  for (const item of open)
    if (item.workAreaId)
      openByArea.set(
        item.workAreaId,
        (openByArea.get(item.workAreaId) ?? 0) + 1,
      );
  const ranked = rankWork(
    areas.map((area) => ({
      id: area.id,
      stakeholder: area.stakeholder,
      client: area.clientWeight,
      dueAt: area.dueAt,
      effort: area.effort,
      lastContextAt: area.lastContextAt,
      interest: area.interest,
      attention: openByArea.get(area.id) ?? 0,
      done: area.status === "done",
    })),
    now,
  );
  const linking = needsLinking(
    snapshot.records
      .filter((record) => inScope(snapshot, record.groupId))
      .map((record) => ({ ...record })),
  );
  return {
    // First use: nothing to resume and nothing waiting.
    welcome: areas.length === 0 && open.length === 0,
    away: awaySummary(items, snapshot.setup.lastSeenAt),
    rows: open.map(attentionRow),
    done: attentionList(items, "done").map(attentionRow),
    island,
    work: ranked.map((entry) => {
      const area = areas.find((item) => item.id === entry.id)!;
      return { area, note: entry.note, waiting: openByArea.get(area.id) ?? 0 };
    }),
    linkingLine: linking.homeLine,
  };
}

/** The exact approval a row's tray offers, taken from its plan. */
export function trayFor(snapshot: Snapshot, attentionId: string) {
  const item = snapshot.attention.find((entry) => entry.id === attentionId);
  const plan = snapshot.plans.find((entry) => "plan:" + entry.id === item?.ref);
  if (!plan || plan.state !== "proposed") return null;
  return {
    plan,
    approve: approveLabel(
      plan.items.length,
      plan.kind === "stories" ? "story" : "change",
    ),
    showAll: `Show all ${plan.items.length} items`,
  };
}

export function workContext(snapshot: Snapshot, areaId: string, now: number) {
  const area = areaOf(snapshot, areaId);
  if (!area) return null;
  const objective = snapshot.objectives.find((item) =>
    item.links.includes(areaId),
  );
  const rfp = snapshot.rfps.find((item) => item.id === areaId);
  return {
    area,
    group: groupName(snapshot, area.groupId),
    objective: objective
      ? { ...objective, progress: objectiveProgress(objective) }
      : null,
    conversion:
      area.type === "task"
        ? conversionSuggestion({
            milestones: area.milestones,
            people: area.people,
            steps: area.steps,
            declinedAt: area.declinedShape,
          })
        : null,
    rfp: rfp ? { ...rfp, card: rfpCard(rfp, now) } : null,
    failure:
      snapshot.attention.find(
        (item) =>
          item.kind === "failure" &&
          item.state === "open" &&
          item.workAreaId === areaId,
      ) ?? null,
    messages: snapshot.messages.filter(
      (message) => message.workAreaId === areaId,
    ),
    related: snapshot.relations
      .filter(
        (relation) => relation.fromId === areaId || relation.toId === areaId,
      )
      .map((relation) => ({
        kind: relation.kind,
        area: areaOf(
          snapshot,
          relation.fromId === areaId ? relation.toId : relation.fromId,
        ),
      }))
      .filter((entry) => entry.area),
    outputs: snapshot.library.filter((item) =>
      item.workAreaIds.includes(areaId),
    ),
  };
}

/**
 * Firstmate's reply is whatever the conversation gained since the last turn,
 * after the user's own message. Returns null when nothing new arrived.
 */
export function replyFromTranscript(
  before: string,
  after: string,
  sent: string,
) {
  let shared = 0;
  const limit = Math.min(before.length, after.length);
  while (shared < limit && before[shared] === after[shared]) shared++;
  let tail = after.slice(shared);
  const echo = tail.lastIndexOf(sent.trim());
  if (sent.trim() && echo >= 0) tail = tail.slice(echo + sent.trim().length);
  const reply = tail
    .replace(/^\s*(?:#+\s*)?(?:assistant|firstmate|pi)\s*:?\s*$/gim, "")
    .trim();
  return reply || null;
}

export function formatDate(now: number, locale = "en-GB") {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}
export function shortDate(value: string | null, locale = "en-GB") {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(time);
}

// ── Firstmate → Amun actions ────────────────────────────────────────────────
// Firstmate may end a reply with fenced blocks tagged `amun`, each one JSON
// object. Almost all of them only *propose*: a plan still needs approval, a
// question waits for an answer, a document is a draft. The one exception is
// renaming the work the conversation is in: it stays inside Amun, changes
// nothing anyone else sees and is undone by renaming again, so the owner
// asked for it to happen at once (13 November 2026). Ids from the model are
// never trusted; everything applies to the work area the conversation is in.
export type AmunAction =
  | { do: "document"; title: string; type: string; body: string }
  | {
      do: "plan";
      planKind: "stories" | "sprint_plan" | "roadmap" | "edit";
      destination: string;
      summary: string;
      items: {
        summary: string;
        fields: Record<string, string | number | null>;
      }[];
    }
  | { do: "question"; title: string; detail: string; options: string[] }
  | { do: "offer"; title: string; detail: string }
  | { do: "scope"; item: string; brd: string | null }
  | { do: "update"; message: string }
  | { do: "rule-case"; situation: string; resolution: string }
  | { do: "rename"; name: string };

const text = (value: unknown, max = 4000) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
function action(raw: unknown): AmunAction | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const title = text(input.title, 200);
  switch (input.do) {
    case "document":
      return title
        ? {
            do: "document",
            title,
            type: text(input.type, 40) ?? "doc",
            body:
              typeof input.body === "string" ? input.body.slice(0, 90000) : "",
          }
        : null;
    case "plan": {
      const items = Array.isArray(input.items)
        ? input.items.flatMap((item) => {
            const summary = text((item as { summary?: unknown })?.summary, 500);
            if (!summary) return [];
            const fields: Record<string, string | number | null> = {};
            const given = (item as { fields?: unknown }).fields;
            if (given && typeof given === "object")
              for (const [key, value] of Object.entries(given).slice(0, 12))
                if (
                  typeof value === "string" ||
                  typeof value === "number" ||
                  value === null
                )
                  fields[key.slice(0, 60)] =
                    typeof value === "string" ? value.slice(0, 500) : value;
            return [{ summary, fields }];
          })
        : [];
      const kind = input.planKind;
      const summary = text(input.summary, 300);
      if (!items.length || !summary) return null;
      return {
        do: "plan",
        planKind:
          kind === "sprint_plan" || kind === "roadmap" || kind === "edit"
            ? kind
            : "stories",
        destination: text(input.destination, 40) ?? "amun",
        summary,
        items: items.slice(0, 200),
      };
    }
    case "question":
      return title
        ? {
            do: "question",
            title,
            detail: text(input.detail, 1000) ?? "",
            options: Array.isArray(input.options)
              ? input.options
                  .flatMap((option) => text(option, 200) ?? [])
                  .slice(0, 6)
              : [],
          }
        : null;
    case "offer":
      return title
        ? { do: "offer", title, detail: text(input.detail, 1000) ?? "" }
        : null;
    case "scope": {
      const item = text(input.item, 200);
      return item ? { do: "scope", item, brd: text(input.brd, 60) } : null;
    }
    case "update": {
      const message = text(input.message, 2000);
      return message ? { do: "update", message } : null;
    }
    case "rename": {
      // One line, no control characters: this becomes the work's title.
      const name = text(
        typeof input.name === "string"
          ? input.name.replace(/\s+/g, " ")
          : input.name,
        120,
      );
      return name ? { do: "rename", name } : null;
    }
    case "rule-case": {
      const situation = text(input.situation, 120);
      const resolution = text(input.resolution, 400);
      return situation && resolution
        ? { do: "rule-case", situation, resolution }
        : null;
    }
    default:
      return null;
  }
}
/** Splits a reply into what the user reads and the actions Firstmate proposed. */
export function parseAmunActions(reply: string) {
  const actions: AmunAction[] = [];
  const visible = reply
    .replace(/```amun\s*\n([\s\S]*?)```/g, (_match, body: string) => {
      try {
        const parsed = action(JSON.parse(body));
        if (parsed) actions.push(parsed);
      } catch {
        /* A malformed block is dropped; it is never shown as raw JSON. */
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: visible, actions: actions.slice(0, 12) };
}
/** Tells Firstmate, once per work area, how to raise things in Amun. */
export const amunProtocol = [
  "You are Firstmate inside Amun. Reply briefly in plain language.",
  "To raise something in Amun, end your reply with one or more fenced blocks tagged amun, each a single JSON object:",
  '{"do":"document","title":"…","type":"prd|brd|research|update|doc","body":"markdown"} saves a draft beside the conversation.',
  '{"do":"rename","name":"…"} renames the work this conversation is about, straight away. It needs no approval and is never raised as a plan. Say in one short line that it is done and what the new name is.',
  '{"do":"plan","planKind":"stories|sprint_plan|roadmap|edit","destination":"ado|notion","summary":"…","items":[{"summary":"…","fields":{}}]} proposes changes to Azure DevOps or Notion, the only places a plan can be published to. Nothing is published until the owner approves exactly that list.',
  '{"do":"question","title":"…","detail":"…","options":["…"]} asks only for information that would change the result.',
  '{"do":"offer","title":"…","detail":"…"} offers a follow-up draft; draft it only after the owner accepts.',
  '{"do":"scope","item":"…","brd":"BRD v2"} flags a request outside the approved scope.',
  '{"do":"update","message":"50–90 words"} gives a stakeholder update to copy; never send it.',
  '{"do":"rule-case","situation":"short-key","resolution":"what the owner decided"} records a repeated decision.',
  "Never write to Azure DevOps, a backlog or a committed roadmap yourself, and never use another group's information without asking.",
].join("\n");
