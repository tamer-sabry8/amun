// Pure derivations from the work snapshot for the rebuilt screens.
import amunCanvasTemplate from "./amun-canvas.md?raw";
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
  | {
      do: "show";
      view:
        | "stories"
        | "receipt"
        | "sprints"
        | "requirements"
        | "release"
        | "activity"
        | "backlog";
      filter: "all" | "drafted" | "published" | "done";
    }
  | {
      do: "show";
      view: "document";
      outputId: string | null;
      title: string | null;
    }
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
    case "show": {
      // Opens a delivery screen or saved document beside this chat; never a write.
      if (input.view === "document") {
        const outputId = text(input.outputId, 256);
        const docTitle = text(input.title, 200);
        return outputId || docTitle
          ? {
              do: "show",
              view: "document",
              outputId,
              title: docTitle,
            }
          : null;
      }
      const views = [
        "stories",
        "receipt",
        "sprints",
        "requirements",
        "release",
        "activity",
        "backlog",
      ] as const;
      const view = views.find((item) => item === input.view);
      const filters = ["all", "drafted", "published", "done"] as const;
      return view
        ? {
            do: "show",
            view,
            filter: filters.find((item) => item === input.filter) ?? "all",
          }
        : null;
    }
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
export type ShowDocumentItem = Snapshot["library"][number];
export type ShowDocumentResolution =
  | { kind: "found"; item: ShowDocumentItem }
  | { kind: "ambiguous"; items: ShowDocumentItem[] }
  | { kind: "missing" };

/**
 * Resolves a prompted `show` document request strictly within the active
 * group/work-area scope. Never guesses across duplicates or crosses groups.
 */
export function resolveShowDocument(
  snapshot: Snapshot,
  query: {
    areaId: string;
    groupId: string | null;
    outputId: string | null;
    title: string | null;
  },
): ShowDocumentResolution {
  const outputId = query.outputId?.trim() ?? "";
  if (outputId) {
    const match = snapshot.library.find(
      (item) =>
        item.section === "output" &&
        item.id === outputId &&
        item.groupId === query.groupId &&
        (query.groupId !== null || item.workAreaIds.includes(query.areaId)),
    );
    return match ? { kind: "found", item: match } : { kind: "missing" };
  }
  const needle = query.title?.trim().toLowerCase() ?? "";
  if (!needle) return { kind: "missing" };
  const inArea = snapshot.library.filter(
    (item) =>
      item.section === "output" &&
      item.groupId === query.groupId &&
      item.workAreaIds.includes(query.areaId) &&
      item.title.trim().toLowerCase() === needle,
  );
  if (inArea.length === 1) return { kind: "found", item: inArea[0]! };
  if (inArea.length > 1) return { kind: "ambiguous", items: inArea };
  if (query.groupId === null) return { kind: "missing" };
  const inGroup = snapshot.library.filter(
    (item) =>
      item.section === "output" &&
      item.groupId === query.groupId &&
      item.title.trim().toLowerCase() === needle,
  );
  if (inGroup.length === 1) return { kind: "found", item: inGroup[0]! };
  if (inGroup.length > 1) return { kind: "ambiguous", items: inGroup };
  return { kind: "missing" };
}

export type LibraryOpenTarget =
  | {
      kind: "open";
      areaId: string;
      chatId: string | null;
      pane: { kind: "output"; id: string };
      focus: { messageId: string; flash: true } | null;
    }
  | { kind: "unlinked" };

/**
 * Resolves clicking a Library item: prefers its canonical verified origin
 * (when the target work area exists and stays in the same group), otherwise
 * preserves the existing local fallback.
 */
export function resolveLibraryOpen(
  snapshot: Snapshot,
  item: Pick<
    Snapshot["library"][number],
    "id" | "type" | "groupId" | "workAreaIds"
  >,
  currentAreaId: string | null,
  currentChatId: string | null,
): LibraryOpenTarget | null {
  if (item.type === "download") return null;
  const full = snapshot.library.find((entry) => entry.id === item.id);
  const origin = full?.origin ?? null;
  if (origin) {
    const targetArea = snapshot.areas.find(
      (area) => area.id === origin.workAreaId,
    );
    const sameGroup =
      item.groupId === null || targetArea?.groupId === item.groupId;
    if (targetArea && sameGroup) {
      return {
        kind: "open",
        areaId: origin.workAreaId,
        chatId: origin.chatId,
        pane: { kind: "output", id: item.id },
        focus: { messageId: origin.messageId, flash: true },
      };
    }
  }
  const areaId = currentAreaId ?? item.workAreaIds[0] ?? null;
  if (!areaId) return { kind: "unlinked" };
  return {
    kind: "open",
    areaId,
    chatId: areaId === currentAreaId ? currentChatId : null,
    pane: { kind: "output", id: item.id },
    focus: null,
  };
}

/** Tells Firstmate, once per work area, how to raise things in Amun. */
export const amunProtocol = amunCanvasTemplate
  .trimEnd()
  .replace(
    "${agentCatalog}",
    agentCatalog.map((agent) => `${agent.name} (${agent.summary})`).join("; "),
  );
