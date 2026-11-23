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
import {
  approveLabel,
  planNoun,
} from "../../../../packages/domain/src/work/permissions.ts";
import { trackerName } from "../../../../packages/domain/src/work/flows.ts";
import {
  agentCatalog,
  agentProfile,
} from "../../../../packages/domain/src/work/agents.ts";
import { openBlockers } from "../../../../packages/domain/src/work/blockers.ts";
import { needsLinking } from "../../../../packages/domain/src/work/model.ts";
import {
  conversionSuggestion,
  knownDate,
  knownNumber,
  objectiveLine,
  objectiveProgress,
  rfpCard,
} from "../../../../packages/domain/src/work/flows.ts";

export type Snapshot = WorkSnapshot;
export type Area = Snapshot["areas"][number];
export const typeLabels: Record<Area["type"], string> = {
  product: "Product",
  project: "Project",
  task: "Initiative",
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

/** Remembered facts that apply to a group's work, plus those kept for everyone. */
export function factsFor(snapshot: Snapshot, groupId: string | null) {
  return snapshot.memory.facts.filter(
    (fact) => fact.groupId === null || fact.groupId === groupId,
  );
}

/** "Create items in Notion": what a standing permission lets Firstmate do. */
export function permissionText(action: string, destination: string) {
  const what =
    { create: "Create items", update: "Update items" }[action] ?? action;
  return `${what} in ${trackerName(destination)}`;
}

/** The current standing permissions for one group, for Firstmate to read. */
export function standingPermissionLines(
  snapshot: Snapshot,
  groupId: string | null,
) {
  return snapshot.permissions
    .filter((item) => !item.revokedAt && item.groupId === groupId)
    .map((item) => permissionText(item.action, item.destination));
}

/** Open blockers on the work the owner can see, oldest first. */
export function scopedBlockers(snapshot: Snapshot) {
  const visible = new Set(
    snapshot.areas
      .filter(
        (area) => inScope(snapshot, area.groupId) && area.status !== "archived",
      )
      .map((area) => area.id),
  );
  return openBlockers(snapshot.blockers).filter((item) =>
    visible.has(item.workAreaId),
  );
}

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
        ref: item.ref,
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
      planNoun(plan.items) ?? (plan.kind === "stories" ? "story" : "change"),
    ),
    showAll: `Show all ${plan.items.length} items`,
  };
}

export function workContext(snapshot: Snapshot, areaId: string, now: number) {
  const area = areaOf(snapshot, areaId);
  if (!area) return null;
  const objectives = snapshot.objectives
    .filter((item) => item.links.includes(areaId))
    .map((item) => ({
      ...item,
      progress: objectiveProgress(item),
      line: objectiveLine(item),
    }));
  const rfp = snapshot.rfps.find((item) => item.id === areaId);
  return {
    area,
    group: groupName(snapshot, area.groupId),
    objectives,
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
  | {
      do: "move";
      name: string;
      type: "product" | "project" | "task" | "rfp";
      /** How many of the owner's latest messages it is about. */
      messages: number;
    }
  | { do: "offer"; title: string; detail: string }
  | { do: "scope"; item: string; brd: string | null }
  | { do: "update"; message: string }
  | { do: "rule-case"; situation: string; resolution: string }
  | { do: "rename"; name: string }
  | { do: "title"; text: string }
  | { do: "client"; name: string | null }
  | { do: "repo"; url: string }
  | {
      do: "objective";
      title: string;
      baseline: number | null;
      target: number | null;
      due: string | null;
      areas: string[];
    }
  | { do: "objective-link"; objective: string; areas: string[] }
  | { do: "blocker"; title: string; owner: string | null }
  | { do: "blocker-owner"; blocker: string; owner: string | null }
  | { do: "unblock"; blocker: string }
  | { do: "fact-correct"; fact: string; value: string }
  | { do: "fact-forget"; fact: string }
  | { do: "delete" }
  | { do: "convert" }
  | { do: "draft-stories" }
  | { do: "use-sprints" }
  | { do: "link-product"; product: string }
  | {
      do: "delegate";
      agent: string;
      title: string;
      task: string;
      acceptance?: boolean;
      repo?: string;
    };

const text = (value: unknown, max = 4000) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const areaNames = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((name) => {
        const clean = text(name, 200);
        return clean ? [clean] : [];
      })
    : [];
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
    case "move": {
      const name = text(input.name, 80);
      const count = Number(input.messages);
      return name
        ? {
            do: "move",
            name,
            type:
              input.type === "product" ||
              input.type === "task" ||
              input.type === "rfp"
                ? input.type
                : "project",
            messages:
              Number.isInteger(count) && count >= 1 ? Math.min(count, 20) : 1,
          }
        : null;
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
    case "title": {
      // A chat's short topic title: one line, a few words.
      const value = text(
        typeof input.text === "string"
          ? input.text.replace(/\s+/g, " ")
          : input.text,
        60,
      );
      return value ? { do: "title", text: value } : null;
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
    case "client": {
      // The client's name, or empty to clear it: one line, like a rename.
      const name =
        typeof input.name === "string"
          ? input.name.replace(/\s+/g, " ").trim().slice(0, 200)
          : null;
      return name === null ? null : { do: "client", name: name || null };
    }
    case "repo": {
      // Only a plain https address: no sign-in details, query or fragment.
      try {
        const url = new URL(typeof input.url === "string" ? input.url : "");
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          return null;
        return { do: "repo", url: url.href.replace(/\/$/, "").slice(0, 2000) };
      } catch {
        return null;
      }
    }
    case "objective": {
      // Only what the owner stated: a missing or unreadable value stays unknown.
      return title
        ? {
            do: "objective",
            title,
            baseline: knownNumber(input.baseline),
            target: knownNumber(input.target),
            due: knownDate(input.due),
            areas: areaNames(input.areas),
          }
        : null;
    }
    case "objective-link": {
      const objective = text(input.objective, 200);
      const areas = areaNames(input.areas);
      return objective && areas.length
        ? { do: "objective-link", objective, areas }
        : null;
    }
    case "blocker": {
      const owner = text(input.owner, 120);
      return title ? { do: "blocker", title, owner } : null;
    }
    case "blocker-owner": {
      // An empty owner clears it, like an empty client.
      const blocker = text(input.blocker, 200);
      const owner =
        typeof input.owner === "string"
          ? input.owner.replace(/\s+/g, " ").trim().slice(0, 120) || null
          : null;
      return blocker ? { do: "blocker-owner", blocker, owner } : null;
    }
    case "unblock": {
      const blocker = text(input.blocker, 200);
      return blocker ? { do: "unblock", blocker } : null;
    }
    case "fact-correct": {
      const fact = text(input.fact, 200);
      const value = text(input.value, 1000);
      return fact && value ? { do: "fact-correct", fact, value } : null;
    }
    case "fact-forget": {
      const fact = text(input.fact, 200);
      return fact ? { do: "fact-forget", fact } : null;
    }
    case "delegate": {
      // Only an agent from the catalogue: a name the model made up is dropped.
      const agent = agentProfile(text(input.agent, 80) ?? "")?.name;
      const task = text(input.task, 8000);
      const repo = /^https:\/\/[^\s"']{1,500}$/.test(
        text(input.repo, 512) ?? "",
      )
        ? text(input.repo, 512)!
        : null;
      return agent && task
        ? {
            do: "delegate",
            agent,
            title: text(input.title, 120) ?? task.slice(0, 80),
            task,
            ...(input.acceptance === true ? { acceptance: true } : {}),
            ...(repo ? { repo } : {}),
          }
        : null;
    }
    case "convert":
      // No id from the model: it always means the work this chat is in.
      return { do: "convert" };
    case "draft-stories":
      // Always this chat's product and its latest PRD version in Amun.
      return { do: "draft-stories" };
    case "use-sprints":
      // Always this chat's project; one-way (Idea to Done §3.2).
      return { do: "use-sprints" };
    case "link-product": {
      const product = text(input.product, 160);
      return product ? { do: "link-product", product } : null;
    }
    case "delete":
      // Only ever a request: the owner confirms it in the chat.
      return { do: "delete" };
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
/**
 * What Firstmate's agents have finished since the owner last wrote. An
 * agent's result reaches the chat and the library, but not Firstmate's own
 * conversation, so it travels with the owner's next message. Without it,
 * "shorten that" would have nothing real to shorten.
 */
export function agentNews(
  messages: { role: string; text: string; card?: unknown }[],
) {
  const last = messages.findLastIndex((message) => message.role === "you");
  const after = messages.slice(last + 1);
  const kind = (message: { card?: unknown }) =>
    (message.card as { kind?: unknown } | null | undefined)?.kind;
  const fresh = after
    .filter((message) => kind(message) === "agent-result")
    .map((message) => message.text.slice(0, 12000));
  const refused = after
    .filter((message) => kind(message) === "plan-refused")
    .map((message) => message.text.slice(0, 2000));
  const retried = after
    .filter((message) => kind(message) === "plan-retry")
    .map((message) => message.text.slice(0, 500));
  const retries = retried.length
    ? "[Amun retried failed items of an approved plan at the owner's request. Outcome: " +
      retried.join(" ") +
      " Do not redo it; say nothing was duplicated if asked.]\n\n"
    : "";
  const refusals = refused.length
    ? "[Amun refused the plan you just proposed, so no plan exists and nothing is waiting for approval. The owner has been told: " +
      refused.join(" ") +
      " Correct anything you said about that plan.]\n\n"
    : "";
  return (
    retries +
    refusals +
    (fresh.length
      ? "[Finished by your agents since your last reply. The owner has already been shown this. Use it as it is; do not redo it.]\n" +
        fresh.join("\n\n---\n\n") +
        "\n[End of what your agents finished.]\n\n"
      : "")
  );
}
/**
 * What this kind of work is for. An RFP in Amun is tracked (client, owner,
 * deadline, status); writing the response is separate product work, so
 * Firstmate must not draft it, offer to, or turn a tracking update away.
 */
export function workTypeGuard(
  type: string,
  record?: {
    client: string;
    deadline: string | null;
    responseOwner: string | null;
    accountOwner?: string | null;
    presales?: string | null;
    stage: string;
    proposalSigned?: boolean;
    brdApproved?: boolean;
  } | null,
) {
  if (type !== "rfp") return "";
  const known = record
    ? ` The record Amun holds right now: client ${record.client || "not set"}, deadline ${record.deadline ? record.deadline.slice(0, 10) : "not set"}, response owner ${record.responseOwner || "not set"}, Sales or account owner ${record.accountOwner || "not set"}, Pre-sales contact ${record.presales || "not set"}, stage ${record.stage}, Proposal signed ${record.proposalSigned ? "yes" : "no"}, BRD approved ${record.brdApproved ? "yes" : "no"}.`
    : "";
  const authority = record
    ? " This record is authoritative for this work area only: never use or offer client, deadline, owner or stage values from another work area or an earlier conversation; if they differ from the record, the record wins."
    : "";
  return `[This is an RFP Amun only tracks: client, owner, deadline, status and notes. ${record ? "This RFP already exists in Amun's RFPs board" : "An RFP work area already exists in Amun; its board record is unverified"}; do not say you cannot create it. Record or update those when asked, and keep the owner's wording; do not invent values that were not given.${known}${authority} Writing or implementing the response belongs to a separate product, so do not write it, start it or offer a proposal or bid draft here.]\n`;
}
/**
 * What Amun has already published from this work area, newest last, for
 * Firstmate: destination, item, external id, when, and the approved plan.
 */
export function publicationLines(
  snapshot: Snapshot,
  areaId: string,
  limit = 20,
) {
  const lines: string[] = [];
  for (const plan of snapshot.plans) {
    if (plan.workAreaId !== areaId) continue;
    for (const result of plan.results) {
      if (result.state !== "created") continue;
      const item = plan.items.find((entry) => entry.id === result.id);
      if (!item) continue;
      const own = item.fields.destination;
      const destination =
        typeof own === "string" && own.trim()
          ? own.trim().toLowerCase()
          : plan.destination;
      lines.push(
        `${trackerName(destination)}: “${item.summary}” ${result.linked ? "already existed as" : "created as"} ${result.externalId ? (/^\d+$/.test(result.externalId) ? "#" : "") + result.externalId : "(no id)"} on ${plan.createdAt.slice(0, 10)}, from the approved plan “${plan.summary || "Proposed changes"}”`,
      );
    }
  }
  return lines.slice(-limit);
}
/**
 * Publication items that were not created or are still being checked, with
 * the destination's own stored reason, so Firstmate can ask the owner for the
 * exact values that are missing. `reasons` is keyed "planId:itemId".
 */
export function failedPublicationLines(
  snapshot: Snapshot,
  areaId: string,
  reasons: Record<string, string>,
  limit = 10,
) {
  const lines: string[] = [];
  for (const plan of snapshot.plans) {
    if (plan.workAreaId !== areaId) continue;
    for (const result of plan.results) {
      if (result.state === "created") continue;
      const item = plan.items.find((entry) => entry.id === result.id);
      if (!item) continue;
      const own = item.fields.destination;
      const destination =
        typeof own === "string" && own.trim()
          ? own.trim().toLowerCase()
          : plan.destination;
      const reason = reasons[`${plan.id}:${item.id}`];
      lines.push(
        `${trackerName(destination)}: “${item.summary}” ${result.state === "failed" ? "was not created" : "is still being checked"}, from the plan “${plan.summary || "Proposed changes"}” of ${plan.createdAt.slice(0, 10)}. Reason: ${reason || "none recorded"}`,
      );
    }
  }
  return lines.slice(-limit);
}
/**
 * The Notion pages Amun created from this work area, one line each, so
 * Firstmate can name the right one when asked to change it: title, page id,
 * link, when created and when last updated by Amun.
 */
export function notionPageLines(
  snapshot: Snapshot,
  areaId: string,
  limit = 20,
) {
  const pages = new Map<
    string,
    { title: string; url: string; created: string; updated: string }
  >();
  const plans = snapshot.plans
    .filter((plan) => plan.workAreaId === areaId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const plan of plans)
    for (const result of plan.results) {
      if (result.state !== "created" || !result.externalId) continue;
      const item = plan.items.find((entry) => entry.id === result.id);
      if (!item) continue;
      const own = item.fields.destination;
      const destination =
        typeof own === "string" && own.trim()
          ? own.trim().toLowerCase()
          : plan.destination;
      if (destination !== "notion") continue;
      const day = plan.createdAt.slice(0, 10);
      const known = pages.get(result.externalId);
      const title =
        typeof item.fields.title === "string" && item.fields.title.trim()
          ? item.fields.title.trim()
          : (known?.title ?? item.summary);
      pages.set(result.externalId, {
        title,
        url: result.url ?? known?.url ?? "",
        created: known?.created ?? day,
        updated: day,
      });
    }
  return [...pages.entries()]
    .slice(-limit)
    .map(
      ([id, page]) =>
        `“${page.title}” page id ${id}${page.url ? ", " + page.url : ""}, created ${page.created}, last updated by Amun ${page.updated}`,
    );
}
/**
 * The header for every turn: Firstmate's conversation is shared by all work
 * areas, so each turn names the one it is about, with its own record.
 */
export function areaTurnContext(
  area: {
    type: string;
    name: string;
    client?: string | null;
    dueAt?: string | null;
  },
  typeLabel: string,
  group: string | null | undefined,
  record?: Parameters<typeof workTypeGuard>[1],
  /** Open blockers as "title (Owner · raised N days ago)". */
  blockers: string[] = [],
  /** Remembered facts as "key: value", so Firstmate can name one back. */
  facts: string[] = [],
  /** Standing permissions for this group, as "Create items in Notion". */
  permissions?: string[],
  /** Which Azure DevOps work item types this project uses. */
  tracker = "",
  /** What was already published from this area (`publicationLines`). */
  published: string[] = [],
  /** Objectives already linked here, and the other areas that could be linked. */
  objectives: string[] = [],
  areaNamesInGroup: string[] = [],
  /** Notion pages Amun created here (`notionPageLines`). */
  notionPages: string[] = [],
  /** Items not created, with their reasons (`failedPublicationLines`). */
  failedItems: string[] = [],
) {
  const failedList = failedItems.length
    ? ` Failed publications from this work area, with the destination's own reason (use it to tell the owner exactly what is missing; never guess a value): ${failedItems.join("; ")}.`
    : "";
  const pageList = notionPages.length
    ? ` Notion pages Amun created in this work area (the only ones Amun can update; use the exact page id as the item's "page" field): ${notionPages.join("; ")}.`
    : "";
  const tracked = objectives.length
    ? ` Objectives linked to this work area: ${objectives.join("; ")}.`
    : "";
  const others = areaNamesInGroup.length
    ? ` Other work areas in this group, for linking an objective: ${areaNamesInGroup.join("; ")}.`
    : "";
  const publications = !published.length
    ? ""
    : ` Already published from this work area, by Amun, with the owner's approval (most recent last): ${published.join("; ")}. Never say nothing was published when this list has entries. If the owner asks to publish something that is already listed, say it already exists with its number and do not raise a plan to create it again; offer an update instead: for an existing Azure DevOps item Amun can only change its iteration (sprint) and who it is assigned to, so say plainly that nothing else about it can be changed yet.`;
  const allowed =
    permissions === undefined
      ? ""
      : ` Standing permissions the owner has set for this group (read-only: only the owner changes them, in Settings): ${permissions.length ? permissions.join("; ") : "none"}.`;
  const remembered = facts.length
    ? ` Remembered facts the owner can have corrected or forgotten: ${facts.join("; ")}.`
    : "";
  const stuck = blockers.length
    ? ` Open blockers: ${blockers.join("; ")}.`
    : "";
  const client =
    area.type === "project"
      ? ` This project exists in Amun. Its saved due date is ${area.dueAt ?? "unset"}. The client of this project is ${area.client || "not set"}; that is authoritative for this project only. For a Project, run a scoped interview in this chat (client or sponsor where applicable, delivery outcome, due date, deliverables, tasks, dependencies, owner and who accepts the work), reusing any existing brief or linked Product facts, asking one unresolved material question at a time, and recording acceptance and handover.`
      : area.type === "task"
        ? ` This Initiative (stored type task) exists in Amun. Its saved due date is ${area.dueAt ?? "unset"}. Retain its outcome, next action, optional deadline, reminder and completion evidence in this Initiative chat. If its scope grows into multiple deliverables or sprints, offer in-place conversion to a Project.`
        : "";
  const types = tracker ? ` ${tracker}` : "";
  return `[${typeLabel}: ${area.name}${group ? " · " + group : ""}. Everything below is about this work area only; details from other work areas or earlier conversations do not apply to it.${client}${stuck}${tracked}${others}${remembered}${allowed}${publications}${failedList}${pageList}${types}]\n${workTypeGuard(area.type, record)}`;
}
/** The length the owner asked for ("1-2 pages", "under 90 words"), if any. */
export function requestedLength(request: string) {
  const match =
    /\b(?:(?:under|below|over|at most|at least|maximum of|max|no more than|up to|within|about|around)\s+)?\d+(?:\s*(?:-|–|to)\s*\d+)?[\s-]*(?:pages?|words?|paragraphs?|sentences?|lines?|bullets?|slides?)\b|\bone[- ]pager\b/i.exec(
      request,
    );
  return match ? match[0].trim() : null;
}
/** A delegation brief that always states the length the owner asked for. */
export function delegationTask(task: string, ownerRequest: string) {
  const length = requestedLength(ownerRequest);
  if (!length || task.toLowerCase().includes(length.toLowerCase())) return task;
  return `${task}\n\nLength the owner asked for: ${length}. Keep to it.`;
}
/** Tells Firstmate, once per work area, how to raise things in Amun. */
export const amunProtocol = [
  "You are Firstmate inside Amun. Reply briefly in plain language.",
  "To raise something in Amun, end your reply with one or more fenced blocks tagged amun, each a single JSON object:",
  '{"do":"document","title":"…","type":"prd|brd|research|update|doc","body":"markdown"} saves a draft beside the conversation.',
  '{"do":"rename","name":"…"} renames the work this conversation is about, straight away. It needs no approval and is never raised as a plan. Say in one short line that it is done and what the new name is.',
  '{"do":"title","text":"…"} names this chat with a short topic title of two to five words, in your first reply in a chat only. Amun keeps any name the owner gave the chat. Do not mention it in your reply.',
  '{"do":"client","name":"…"} sets the client of this project straight away when the owner says who it is for (for example "for client Acme"); an empty name clears it. It needs no approval and is never raised as a plan. Only for a project. Say in one short line that it is done and who the client is.',
  '{"do":"repo","url":"https://github.com/owner/name"} connects the repository this project\'s code lives in, straight away, when the owner tells you which repository to use. It lets Amun read its pull requests. Your agents can also change code in it, but only in Amun\'s own copy: the owner reads the exact change, and only after they approve does Amun open a pull request. Nothing is ever merged by an agent, and merging always needs the owner\'s approval. Say in one short line that it is connected.',
  '{"do":"objective","title":"what we are measuring or aiming for","baseline":number,"target":number,"due":"YYYY-MM-DD","areas":["names of other work areas in this group to link"]} saves an objective on this Mac straight away when the owner writes "Objective: …", and links it to this work area plus any areas they name. Leave baseline, target and due out unless the owner gave them: never guess a baseline or a date; a missing baseline shows as unknown. {"do":"objective-link","objective":"words from its title","areas":["work area names"]} links an existing objective to more work areas in this group when the owner asks. Neither needs approval or is a plan, and neither changes anything outside Amun. Say in one short line what you saved or linked.',
  '{"do":"blocker","title":"what is stuck","owner":"who unblocks it, if known"} records a blocker on this work straight away; leave owner out when the owner has not said. {"do":"blocker-owner","blocker":"words from its title","owner":"…"} sets or changes who owns unblocking it (empty clears it). {"do":"unblock","blocker":"words from its title"} clears it when the owner says it is resolved. None needs approval or is a plan. Say in one short line what you recorded.',
  '{"do":"fact-correct","fact":"words from the fact","value":"the corrected fact"} corrects a remembered fact straight away when the owner says it is wrong; {"do":"fact-forget","fact":"words from the fact"} forgets one when the owner asks. Neither needs approval or is a plan, and both only change what Amun remembers on this Mac. A fact kept in Notion stays there until the owner removes it. A pinned memory entry is never changed this way. Say in one short line what you changed.',
  `{"do":"delegate","agent":"…","title":"short name of the job","task":"everything the agent needs to do it"} (add "repo":"https://github.com/owner/name", the connected repository, when the owner asks for a change to code in it: pick an agent whose profile fits code and README edits, normally Solution & AI Architecture, never Product Manager; it works in Amun\'s own copy, you never edit code yourself, and the owner reviews the exact change before any pull request is opened; add "acceptance":true when the owner asks for an acceptance checklist for a story or deliverable: give it to QA, and the checklist comes back for the owner to accept or not) hands a job to one of your agents, who does it and reports back to you; you then pass the result on. You are the coordinator: anything that is real work (a PRD, research, test cases, a competitive review, pricing options, release notes, a stakeholder pack) goes to the agent whose job it is, never written by you. Answer quick questions and make small changes yourself. Pick the agent by what it is for, tell the owner in one line who is on it, and never claim the work is done before the result arrives. Your agents: ${agentCatalog.map((agent) => `${agent.name} (${agent.summary})`).join("; ")}.`,
  "When the owner states a length for a document (for example 1-2 pages or under 90 words), say it in the delegate task as a line of its own, in the owner's words, and keep to it.",
  '{"do":"convert"} turns this Initiative (stored type task) into a project, in place, when the owner explicitly asks for it. The conversation, history, links, objective and tracker stay, it stays in its group, and nothing outside Amun is created or moved. Amun reports whether it worked, so never say it is converted yourself; only that you have asked Amun to.',
  '{"do":"link-product","product":"name of the product"} links this bounded Project to an existing Product in the same group as implementing it, when the owner authorizes the association. It needs no provider plan and reuses the linked Product facts.',
  '{"do":"delete"} asks the owner to confirm deleting the work this conversation is about. Use it when they ask to delete or remove it. You cannot delete it yourself, so never say it is deleted; say you have asked them to confirm.',
  '{"do":"plan","planKind":"stories|sprint_plan|roadmap|edit","destination":"ado|notion|jira|linear","summary":"…","items":[{"summary":"…","fields":{}}]} proposes changes to Azure DevOps, Notion, Jira or Linear, the only places a plan can be published to. Amun raises the plan and may refuse it; never say a review card or plan is ready, shown or waiting, only that you have asked Amun to raise it for approval. Nothing is published until the owner approves exactly that list. Write item fields with these exact lowercase names. Azure DevOps, new item: type, description, acceptance (one criterion per line), area, iteration, parent (the number of an existing work item in this same project to create it under, for example a Task under #123: set type to the task type and parent to "123"), and the required fields of the work item type listed above for this project, plus "Original Estimate", "Remaining Work" and "Completed Work" (numbers, in hours) and "Activity" when the project has them. Where a field lists allowed values, only one of those is accepted. Never pick a required value yourself: ask the owner for exactly the values the type needs, listing the allowed values for a choice, then put them in the fields of the item under those names. Amun can set that parent link: it checks the parent exists, shows "Under #123" on the review card for the owner to approve, and verifies the link after creating. Never say Amun cannot set a parent or that the item will be standalone. Azure DevOps, existing item (moving it to a sprint or changing who it is assigned to): workitem (its number) plus iteration and/or assignedto (a name or email), and nothing else. Notion, new page: title (the page title), body; it goes under the Notion destination chosen in Settings, which the review card shows. Notion, update of a page Amun created (listed above in this work area): page (its exact page id or link from that list), plus title (optional; kept when left out) and either body (the whole new text) or append (only the lines to add at the end of the existing text), never both; the review card shows the exact result for the owner to approve. Amun cannot update any page it did not create, so say so plainly and do not raise a plan for one. Jira and Linear, new items only (one plan per destination; earlier items first): type (Epic, Story, Task or Sprint), site (Jira: the site host such as example.atlassian.net; Linear: the workspace key), project (Jira project key) or team (Linear team key), description, acceptance (one criterion per line), parent (the exact summary of an Epic or Story earlier in the same plan, or an existing key such as PROJ-12, TRA-12 or a Linear project P-TRA-3), and sprint (the exact summary of a Sprint earlier in the same plan, or an existing Jira sprint number or Linear cycle number). A Jira Sprint item needs board (its number), and start and end (YYYY-MM-DD); add "start sprint":"yes" only when the owner asks to start it. A Linear Epic becomes a Linear project; add "epic as":"issue" for a parent issue instead. Linear cycles cannot be created or started through Amun: say so and plan stories into an existing cycle. Run `~/.amun/bin/amun-tracker status` to see whether Jira and Linear are connected and `~/.amun/bin/amun-tracker targets jira` (or linear) for the sites, projects, boards, sprints, teams and cycles you may name; never guess one. Leave out any other field, because it will be refused, and never name a different project. If an item was not created, its reason is listed under the failed publications above: use it, tell the owner what is needed, and raise a corrected plan; never guess. A plan is never local: if the owner asks for a local-only change or says not to publish to a tracker or Notion, do not raise a plan. Stories can still be drafted in Amun with {"do":"draft-stories"}; only adding stories to a local draft sprint is not available yet, so say that plainly and that nothing was changed.',
  '{"do":"draft-stories"} asks Amun to draft editable stories with acceptance criteria in this conversation from this product\'s latest PRD saved in Amun. A PRD your Product Manager crew wrote for an Amun request is saved there by Amun automatically, as the next PRD version. Use it instead of a plan, a CSV or a file whenever the owner asks for epics, stories or acceptance criteria from the PRD, including when no tracker is connected: the drafts show "Backlog comparison pending" until a backlog is chosen. Amun drafts only from a PRD version the owner has approved; when it is not approved yet, Amun tells the owner where to approve it. Drafting changes no tracker, and publishing stays a plan the owner approves. Say only that you asked Amun to draft them. A Project drafts the same way from its BRD (or PRD) once it runs with stories and sprints.',
  '{"do":"use-sprints"} switches the Project this conversation is in from its checklist to stories and sprints: its checklist tasks become stories, Done kept, and it can then have a BRD or PRD, stories and sprints like a Product. It cannot be undone. When the owner asks a Project still on its checklist for a BRD, stories or sprints, first ask once: "Run <project> with stories and sprints instead of a checklist? Your <n> checklist tasks become stories." Send this block only after the owner says yes, and never for a Product or an Initiative.',
  '{"do":"question","title":"…","detail":"…","options":["…"]} asks only for information that would change the result. When a crew member is blocked on the owner, include this question with the actual decision and choices in your reply so Amun can surface it. Reuse an already-open question for the same decision.',
  '{"do":"move","name":"…","type":"product|project|task|rfp","messages":2} suggests that the owner\'s latest messages in this chat belong in a folder of their own, when the owner has clearly moved on to a different product, project, task or RFP than the one this work area is about; "messages" is how many of the owner\'s latest messages are about it, and "name" is what the owner calls it. Amun asks the owner, and nothing moves unless they agree. Suggest it at most once per subject and only when you are sure: never for a passing mention, never for something that is part of this work area, and never for a name the owner already chose to keep here. Keep answering the owner here as usual, and do not say that anything was moved.',
  '{"do":"offer","title":"…","detail":"…"} offers a follow-up draft; draft it only after the owner accepts.',
  '{"do":"scope","item":"…","brd":"BRD v2"} flags a request outside the approved scope.',
  '{"do":"update","message":"50–90 words"} gives a stakeholder update to copy; never send it. Do not list blockers in it: Amun adds each open blocker with its owner and how long ago it was raised.',
  '{"do":"rule-case","situation":"short-key","resolution":"what the owner decided"} records a repeated decision.',
  "Where you run: Amun routes you and all of your agents through GitHub Copilot (the Pi worker, provider github-copilot) and nothing else. If asked which provider or engine you use, say so. This is how Amun is set up, so do not claim you cannot confirm it. It does not prove any particular piece of work ran: never call work done until an agent's result has actually arrived.",
  "The work this conversation is about already exists in Amun when you are first spoken to, even if the owner's first message asks to create it: Amun created it before this conversation started. Do not say you cannot create it or that nothing was created; continue from it, and say only what you actually know about it.",
  "Each message names the work area it is about and may carry that area's record. Use only that area's record. Never use or offer values (client, deadline, owner, stage, names) from other work areas or earlier conversations for it; if they differ from the current record, the current record wins.",
  "Notion: Amun holds the owner's Notion connection. To read from it, run `~/.amun/bin/amun-notion search <words>` or `~/.amun/bin/amun-notion read <page link or id>`, and use what comes back. If it says Notion is not connected, tell the owner to connect it in Settings, Tools. You cannot write to Notion yourself: propose a plan with destination notion instead.",
  "Keep Firstmate itself working without asking the owner: re-arm the watcher, clear a lock held by a process that no longer runs, rerun a check that timed out. Do it, then say in one short line what you fixed. Ask the owner only when a fix would change, stop or lose their work or their crew's work.",
  "When the owner asks to be interviewed, the crewmate you hand the interview to writes the questions; relay each one to the owner the moment it arrives, one question at a time, and pass each answer straight back. Tell the owner who is preparing the next question.",
  "Never write to Azure DevOps, a backlog or a committed roadmap yourself, and never use another group's information without asking.",
  "When the owner asks you to use another group's product or work, always offer to ask for their approval to bring that group's material across, and never use it until they approve.",
  "When the owner says an article or link is general reading to leave unlinked and not to ask again, save it as an unlinked reading note (a document of type doc) with exactly the title they gave, do not ask what to link it to or remind them later, and confirm in one line that it is saved.",
  "A stakeholder update names the record each claim comes from, with its title in square brackets, whenever a record exists.",
  "An RFP that is won is handed on only from the RFP card's Hand to delivery step, once Proposal signed and BRD approved are both ticked. Do not convert it or create a delivery project yourself: name the prerequisites still missing and point the owner to Hand to delivery on the RFP card.",
].join("\n");
