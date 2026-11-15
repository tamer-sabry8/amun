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
import {
  agentCatalog,
  agentProfile,
} from "../../../../packages/domain/src/work/agents.ts";
import { openBlockers } from "../../../../packages/domain/src/work/blockers.ts";
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

/** Remembered facts that apply to a group's work, plus those kept for everyone. */
export function factsFor(snapshot: Snapshot, groupId: string | null) {
  return snapshot.memory.facts.filter(
    (fact) => fact.groupId === null || fact.groupId === groupId,
  );
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
  | { do: "rename"; name: string }
  | { do: "client"; name: string | null }
  | { do: "blocker"; title: string; owner: string | null }
  | { do: "blocker-owner"; blocker: string; owner: string | null }
  | { do: "unblock"; blocker: string }
  | { do: "fact-correct"; fact: string; value: string }
  | { do: "fact-forget"; fact: string }
  | { do: "delete" }
  | { do: "convert" }
  | { do: "delegate"; agent: string; title: string; task: string };

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
    case "client": {
      // The client's name, or empty to clear it: one line, like a rename.
      const name =
        typeof input.name === "string"
          ? input.name.replace(/\s+/g, " ").trim().slice(0, 200)
          : null;
      return name === null ? null : { do: "client", name: name || null };
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
      return agent && task
        ? {
            do: "delegate",
            agent,
            title: text(input.title, 120) ?? task.slice(0, 80),
            task,
          }
        : null;
    }
    case "convert":
      // No id from the model: it always means the work this chat is in.
      return { do: "convert" };
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
  const refusals = refused.length
    ? "[Amun refused the plan you just proposed, so no plan exists and nothing is waiting for approval. The owner has been told: " +
      refused.join(" ") +
      " Correct anything you said about that plan.]\n\n"
    : "";
  return (
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
 * The header for every turn: Firstmate's conversation is shared by all work
 * areas, so each turn names the one it is about, with its own record.
 */
export function areaTurnContext(
  area: { type: string; name: string; client?: string | null },
  typeLabel: string,
  group: string | null | undefined,
  record?: Parameters<typeof workTypeGuard>[1],
  /** Open blockers as "title (Owner · raised N days ago)". */
  blockers: string[] = [],
  /** Remembered facts as "key: value", so Firstmate can name one back. */
  facts: string[] = [],
) {
  const remembered = facts.length
    ? ` Remembered facts the owner can have corrected or forgotten: ${facts.join("; ")}.`
    : "";
  const stuck = blockers.length
    ? ` Open blockers: ${blockers.join("; ")}.`
    : "";
  const client =
    area.type === "project"
      ? ` The client of this project is ${area.client || "not set"}; that is authoritative for this project only.`
      : "";
  return `[${typeLabel}: ${area.name}${group ? " · " + group : ""}. Everything below is about this work area only; details from other work areas or earlier conversations do not apply to it.${client}${stuck}${remembered}]\n${workTypeGuard(area.type, record)}`;
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
  '{"do":"client","name":"…"} sets the client of this project straight away when the owner says who it is for (for example "for client Acme"); an empty name clears it. It needs no approval and is never raised as a plan. Only for a project. Say in one short line that it is done and who the client is.',
  '{"do":"blocker","title":"what is stuck","owner":"who unblocks it, if known"} records a blocker on this work straight away; leave owner out when the owner has not said. {"do":"blocker-owner","blocker":"words from its title","owner":"…"} sets or changes who owns unblocking it (empty clears it). {"do":"unblock","blocker":"words from its title"} clears it when the owner says it is resolved. None needs approval or is a plan. Say in one short line what you recorded.',
  '{"do":"fact-correct","fact":"words from the fact","value":"the corrected fact"} corrects a remembered fact straight away when the owner says it is wrong; {"do":"fact-forget","fact":"words from the fact"} forgets one when the owner asks. Neither needs approval or is a plan, and both only change what Amun remembers on this Mac. A fact kept in Notion stays there until the owner removes it. A pinned memory entry is never changed this way. Say in one short line what you changed.',
  `{"do":"delegate","agent":"…","title":"short name of the job","task":"everything the agent needs to do it"} hands a job to one of your agents, who does it and reports back to you; you then pass the result on. You are the coordinator: anything that is real work (a PRD, research, test cases, a competitive review, pricing options, release notes, a stakeholder pack) goes to the agent whose job it is, never written by you. Answer quick questions and make small changes yourself. Pick the agent by what it is for, tell the owner in one line who is on it, and never claim the work is done before the result arrives. Your agents: ${agentCatalog.map((agent) => `${agent.name} (${agent.summary})`).join("; ")}.`,
  "When the owner states a length for a document (for example 1-2 pages or under 90 words), say it in the delegate task as a line of its own, in the owner's words, and keep to it.",
  '{"do":"convert"} turns this task into a project, in place, when the owner explicitly asks for it. The conversation, history, links, objective and tracker stay, it stays in its group, and nothing outside Amun is created or moved. Amun reports whether it worked, so never say it is converted yourself; only that you have asked Amun to.',
  '{"do":"delete"} asks the owner to confirm deleting the work this conversation is about. Use it when they ask to delete or remove it. You cannot delete it yourself, so never say it is deleted; say you have asked them to confirm.',
  '{"do":"plan","planKind":"stories|sprint_plan|roadmap|edit","destination":"ado|notion","summary":"…","items":[{"summary":"…","fields":{}}]} proposes changes to Azure DevOps or Notion, the only places a plan can be published to. Nothing is published until the owner approves exactly that list. Write item fields with these exact lowercase names. Azure DevOps: type, description, acceptance (one criterion per line), area, iteration. Notion: title (the page title), body. Leave out anything else, such as assignee or estimate, because it will be refused, and never name a different project or parent. Stories cannot yet be added to a local draft sprint, and a plan is never local: if the owner asks for a local-only change or says not to publish or change Azure DevOps or Notion, do not raise a plan; say plainly that adding stories to a draft sprint is not available yet and nothing was changed.',
  '{"do":"question","title":"…","detail":"…","options":["…"]} asks only for information that would change the result.',
  '{"do":"offer","title":"…","detail":"…"} offers a follow-up draft; draft it only after the owner accepts.',
  '{"do":"scope","item":"…","brd":"BRD v2"} flags a request outside the approved scope.',
  '{"do":"update","message":"50–90 words"} gives a stakeholder update to copy; never send it. Do not list blockers in it: Amun adds each open blocker with its owner and how long ago it was raised.',
  '{"do":"rule-case","situation":"short-key","resolution":"what the owner decided"} records a repeated decision.',
  "Where you run: Amun routes you and all of your agents through GitHub Copilot (the Pi worker, provider github-copilot) and nothing else. If asked which provider or engine you use, say so. This is how Amun is set up, so do not claim you cannot confirm it. It does not prove any particular piece of work ran: never call work done until an agent's result has actually arrived.",
  "The work this conversation is about already exists in Amun when you are first spoken to, even if the owner's first message asks to create it: Amun created it before this conversation started. Do not say you cannot create it or that nothing was created; continue from it, and say only what you actually know about it.",
  "Each message names the work area it is about and may carry that area's record. Use only that area's record. Never use or offer values (client, deadline, owner, stage, names) from other work areas or earlier conversations for it; if they differ from the current record, the current record wins.",
  "Never write to Azure DevOps, a backlog or a committed roadmap yourself, and never use another group's information without asking.",
  "When the owner asks you to use another group's product or work, always offer to ask for their approval to bring that group's material across, and never use it until they approve.",
  "When the owner says an article or link is general reading to leave unlinked and not to ask again, save it as an unlinked reading note (a document of type doc) with exactly the title they gave, do not ask what to link it to or remind them later, and confirm in one line that it is saved.",
  "A stakeholder update names the record each claim comes from, with its title in square brackets, whenever a record exists.",
  "An RFP that is won is handed on only from the RFP card's Hand to delivery step, once Proposal signed and BRD approved are both ticked. Do not convert it or create a delivery project yourself: name the prerequisites still missing and point the owner to Hand to delivery on the RFP card.",
].join("\n");
