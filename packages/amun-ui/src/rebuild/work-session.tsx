import { inspectView } from "../daemon/navigation.ts";
import { StoryProposals } from "./story-proposals.tsx";
import { ReviewOrigin } from "./review-origin.tsx";
// Work session (handoff §7): conversation on the left, live artifact on the
// right with a draggable divider. Opening a work area lands here directly.
import { BlockerRow } from "./blocker-row.tsx";
import { WhatHappened } from "./what-happened.tsx";
import {
  AzureConnectCard,
  QuestionCard,
  useAzureConnected,
} from "./question-card.tsx";
import {
  mentionsAzureDevOps,
  parseQuestion,
} from "../../../../packages/domain/src/work/question-choices.ts";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useReading, type ReadingFocus } from "./reading.ts";
import { AskAttachment, askCardOf } from "./ask-card.tsx";
import { DeliveredReply, RequestLine, deliveredOf } from "./delivery.tsx";
import { requestRefOf } from "./requests.ts";
import {
  newRequestRef,
  readRequestBlocks,
  requestLine,
  requestProtocol,
  requestStatusLine,
} from "../../../../packages/domain/src/work/requests.ts";
import { chatKey } from "../../../../packages/domain/src/work/chat-lists.ts";
import {
  askDraftKey,
  chatDraftKey,
  folderDraftKey,
  homeDraftKey,
  setAsk,
  setWriting,
  useChatMemory,
} from "./chat-memory.ts";
import { previewResult, type WorkspaceSnapshot } from "@amun/contracts";
import {
  failureOverflow,
  planStateNote,
  previewNote,
  updateMessage,
} from "../../../../packages/domain/src/work/home.ts";
import { adoParentOf } from "../../../../packages/domain/src/ado-update.ts";
import {
  approveLabel,
  countedNoun,
  planNoun,
} from "../../../../packages/domain/src/work/permissions.ts";
import {
  rfpAuthoringBoundary,
  scopeCheck,
  planDestinations,
  trackerName,
} from "../../../../packages/domain/src/work/flows.ts";
import {
  maxRatio,
  minRatio,
  modelDisplay,
} from "../../../../packages/domain/src/work/shell.ts";
import { previewSource } from "../../../../packages/domain/src/work/prototype-source.ts";
import { browserBounds, coverSelector } from "./browser-bounds.ts";
import { copyText } from "./clipboard.ts";
import { useDismiss } from "./use-dismiss.ts";
import { latestTurnStart } from "./scroll-target.ts";

const noMessages: never[] = [];
import { FirstmateMark } from "./firstmate-mark.tsx";
import { waitParts, waitReason } from "./held-wait.ts";
import { Icon } from "../icons.tsx";
import { Backlog, PrdView } from "./lazy.tsx";
import { PullRequests } from "./pull-requests.tsx";
import { takeSprintContext } from "./sprint-context.ts";
import { Composer } from "./composer.tsx";
import { documentContext, draftBodies } from "./document-context.ts";
import {
  MarkdownDoc,
  MarkdownMessage,
  type Citations,
} from "./markdown-doc.tsx";
import { citationContext, type Cite } from "./citations.ts";
import { browserStore, readSource } from "../backlog-selection.ts";
import {
  acceptanceLabel,
  approvalLabel,
  approvalOf,
  decisionWords,
  type Decision,
} from "./document-approval.ts";
import {
  acceptanceType,
  checklistSummary,
} from "../../../../packages/domain/src/work/acceptance.ts";
import { VersionHistory } from "./document-versions.tsx";
import { tableSnippet, toggleTask } from "./markdown-view.ts";
import {
  askFirstmate,
  heldMessage,
  heldQueue,
  observeHeldMessages,
  inFlight,
  holdMessage,
  markBriefed,
  needsBriefing,
  releaseMessage,
} from "./firstmate.ts";
import { bridge } from "../bridge.ts";
import {
  attachmentBlock,
  portionWords,
  useAttachments,
} from "./attachments.ts";
import {
  planPlacesResult,
  trackerTypesResult,
} from "../../../../packages/contracts/src/work.ts";
import { typeName } from "./rail.tsx";
import { work as storeWork, workAsync as storeWorkAsync } from "./store.ts";
import { chatNote, chatRecap, forkNote, forkPoint } from "./fork.ts";
import {
  generalConversationName,
  routeNewWork,
  sameWorkName,
} from "../../../../packages/domain/src/work/model.ts";
import {
  asMoveOffer,
  asMovedLine,
  isMoveQuestion,
  moveQuestion,
  sendAsTyped,
  takeAsTyped,
  type MoveOffer,
} from "./move-offers.ts";
import { askWhereItGoes, localDay } from "./move-ask.ts";
import { chatsOf } from "../../../../packages/domain/src/work/chats.ts";
import {
  answerQuestion,
  answerScope,
  requestPlanChanges,
} from "./accept-offer.ts";
import { pendingOffers } from "./offer-turns.ts";
import {
  blockerLine,
  blockerUpdateLines,
  findBlocker,
  openBlockers,
} from "../../../../packages/domain/src/work/blockers.ts";
import {
  factLine,
  findFact,
} from "../../../../packages/domain/src/work/facts.ts";
import { findNamed } from "../../../../packages/domain/src/work/flows.ts";
import { reminderIntent } from "../../../../packages/domain/src/work/reminders.ts";
import {
  retryIntent,
  retryTarget,
} from "../../../../packages/domain/src/work/retry-request.ts";
import {
  agentNews,
  delegationTask,
  factsFor,
  amunProtocol,
  areaTurnContext,
  publicationLines,
  failedPublicationLines,
  notionPageLines,
  standingPermissionLines,
  areaOf,
  parseAmunActions,
  typeLabels,
  workContext,
  type AmunAction,
  type Snapshot,
} from "./view-model.ts";

const work = storeWork;

export type PaneTarget =
  | {
      kind: "output";
      id: string;
      /** A delivery reply opens the exact version it delivered. */
      version?: number;
    }
  | { kind: "plan"; id: string }
  | { kind: "prd"; objectiveId?: string }
  | { kind: "backlog" }
  | { kind: "pulls" }
  | { kind: "browser"; url: string }
  /** "What happened": Firstmate's steps in this conversation, read only. */
  | { kind: "happened"; stepId?: string }
  | null;

const browserCommand = (value: unknown) =>
  window.postMessage({ kind: "amun-browser-command", command: value }, "*");
/**
 * The isolated browser view, placed over this pane. It follows the pane as
 * the divider moves, so it is as wide as the user makes it (BF014).
 */
export function BrowserPane({
  url,
  hidden,
  fit,
}: {
  url: string;
  hidden: boolean;
  /** For a page with a fixed design: the size it was made for. The page is
      shrunk until that much of it fits the panel, and the address bar is left
      out, since there is nowhere else to go. */
  fit?: { width: number; height: number };
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState(url);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.data?.kind === "amun-browser-status" &&
        typeof event.data.message === "string"
      )
        setStatus(event.data.message);
    };
    window.addEventListener("message", listener);
    browserCommand({ action: "navigate", url });
    return () => window.removeEventListener("message", listener);
  }, [url]);
  useEffect(() => {
    const update = () => {
      const panel = viewport.current;
      const scroller = panel?.closest(".rb-scroll");
      const placed = browserBounds(
        panel?.getBoundingClientRect() ?? null,
        [
          { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
          ...(scroller ? [scroller.getBoundingClientRect()] : []),
        ],
        [...document.querySelectorAll(coverSelector)]
          .filter((cover) => !cover.contains(panel ?? null))
          .map((cover) => cover.getBoundingClientRect()),
      );
      const size = panel?.getBoundingClientRect();
      browserCommand({
        ...(fit &&
          size && {
            zoom: Math.max(
              0.3,
              Math.min(1, size.width / fit.width, size.height / fit.height),
            ),
          }),
        action: "layout",
        // Search dims the whole window, so the room goes with it.
        visible:
          !hidden && placed.visible && !document.querySelector("dialog:modal"),
        bounds: placed.bounds,
      });
    };
    // The panel moves without changing size when the screen scrolls or
    // something opens above it, so those are watched as well as its size.
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(soon);
    if (viewport.current) observer.observe(viewport.current);
    const changes = new MutationObserver(soon);
    changes.observe(document.body, {
      childList: true,
      subtree: true,
      // Search and the panels are shown and hidden without being rebuilt.
      attributes: true,
      attributeFilter: ["class", "open", "hidden", "style", "aria-hidden"],
    });
    window.addEventListener("resize", soon);
    document.addEventListener("scroll", soon, true);
    // A screen that eases in is a few pixels off until it lands.
    document.addEventListener("animationend", soon, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", soon);
      document.removeEventListener("scroll", soon, true);
      document.removeEventListener("animationend", soon, true);
      browserCommand({
        action: "layout",
        visible: false,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      });
    };
  }, [hidden, fit?.width, fit?.height]);
  if (fit) return <div ref={viewport} style={{ height: "100%" }} />;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 8,
        maxWidth: "none",
      }}
    >
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          browserCommand({ action: "navigate", url: address });
        }}
      >
        <button
          type="button"
          className="btn quiet"
          onClick={() => browserCommand({ action: "back" })}
        >
          Back
        </button>
        <button
          type="button"
          className="btn quiet"
          onClick={() => browserCommand({ action: "reload" })}
        >
          Reload
        </button>
        <input
          type="text"
          className="grow"
          aria-label="Address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </form>
      {status && (
        <p className="muted small" role="status">
          {status}
        </p>
      )}
      <div ref={viewport} style={{ flex: 1, minHeight: 200 }} />
    </div>
  );
}

interface Card {
  kind: string;
  [key: string]: unknown;
}

function InlineCard({
  snapshot,
  areaId,
  card,
}: {
  snapshot: Snapshot;
  areaId: string;
  card: Card;
}) {
  const [copied, setCopied] = useState("");
  const [kept, setKept] = useState(false);
  if (card.kind === "delete-work") {
    const area = areaOf(snapshot, areaId);
    if (kept || !area)
      return (
        <div className="rb-inline">
          <span className="note">Kept. Nothing was deleted.</span>
        </div>
      );
    return (
      <div
        className="rb-inline amber"
        role="group"
        aria-label="Delete this work"
      >
        <span>
          <strong>Delete “{area.name}”?</strong> Its chat, plans and anything
          waiting on it go with it. Nothing already in Azure DevOps or Notion is
          touched.
        </span>
        <div className="row wrap">
          <button
            className="btn"
            onClick={() => work("delete-area", { areaId })}
          >
            Delete it
          </button>
          <button className="btn quiet" onClick={() => setKept(true)}>
            Keep it
          </button>
        </div>
      </div>
    );
  }
  if (card.kind === "scope") {
    const item = String(card.item ?? "This request");
    const prior = snapshot.decisions.some(
      (decision) =>
        decision.source === "exception" && decision.affected.includes(item),
    );
    const check = scopeCheck({
      inScope: false,
      approvedChangeRequest: false,
      ...(card.brd ? { brdVersion: String(card.brd) } : {}),
      prior: prior ? "add_anyway" : null,
    });
    if (check.step !== "ask")
      return (
        <div className="rb-inline">
          <span>
            {item} <span className="tag warn">Exception · no CR</span>
          </span>
          <span className="note">
            Recorded in Decisions. Not raised again for this item.
          </span>
        </div>
      );
    return (
      <div
        className="rb-inline amber"
        role="group"
        aria-label="Outside the approved scope"
      >
        <strong>{item}</strong>
        <span>{check.text}</span>
        <div className="row wrap">
          {(
            [
              ["add_anyway", check.choices[0]],
              ["link_cr", check.choices[1]],
              ["keep_out", check.choices[2]],
            ] as const
          ).map(([answer, label]) => (
            <button
              key={answer}
              className="btn"
              onClick={() => answerScope({ areaId, item, answer })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (card.kind === "update") {
    const text = String(card.message ?? "");
    // The blocker lines Amun adds are not part of the 50–90 words.
    const check = updateMessage(text.split(/\n\n(?=Blocked: )/)[0] ?? text);
    const copy = async (what: string, value: string) => {
      if (await copyText(value)) setCopied(what);
    };
    return (
      <div className="rb-inline" role="group" aria-label="Stakeholder update">
        <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
        <div className="row wrap">
          <button className="btn" onClick={() => copy("message", text)}>
            {copied === "message" ? "Copied" : check.actions[0]}
          </button>
          <span className="muted small">
            {check.words} words{check.hint ? ` · ${check.hint}` : ""}
          </span>
        </div>
        <span className="note">{check.note}</span>
      </div>
    );
  }
  if (card.kind === "note")
    return (
      <div className="rb-inline">
        <span>{String(card.text ?? "")}</span>
        {typeof card.note === "string" && (
          <span className="note">{card.note}</span>
        )}
      </div>
    );
  return null;
}

interface Place {
  id: string;
  destination: string;
  place: string | null;
  problem: string | null;
  kind?: string | null | undefined;
  note?: string | null | undefined;
  existing?: { id: string } | null | undefined;
  change?:
    { kind: "same" | "add" | "remove"; text: string }[] | null | undefined;
  failure?: string | null | undefined;
  changedInNotion?: boolean | undefined;
  sentAs?: string | undefined;
  content?: string | null | undefined;
  parent?:
    | { id: string; title: string | null; problem: string | null }
    | null
    | undefined;
}
/** Where each item of a plan would go, asked from the service. */
function usePlaces(planId: string, fingerprint: string) {
  const [places, setPlaces] = useState<Place[]>([]);
  useEffect(() => {
    const stop = bridge.onEvent((raw) => {
      const event = planPlacesResult.safeParse(raw);
      if (event.success && event.data.planId === planId)
        setPlaces(event.data.places);
    });
    bridge.send({ version: 1, kind: "plan-places", planId });
    return stop;
  }, [planId, fingerprint]);
  return places;
}

type TrackerTypes = {
  project: string;
  story: string;
  task: string | null;
  needs: { type: string; fields: string[] }[];
};
const preparing = new Map<string, Promise<void>>();
const trackerCache = new Map<string, TrackerTypes>();
/**
 * The work item types of the area's Azure DevOps project, so Firstmate
 * proposes the project's own type from the start. Read once per area; a slow
 * or missing answer only means Firstmate is not told.
 */
function askTrackerTypes(areaId: string) {
  const known = trackerCache.get(areaId);
  if (known) return Promise.resolve(known);
  return new Promise<TrackerTypes | null>((resolve) => {
    const finish = (value: TrackerTypes | null) => {
      stop();
      clearTimeout(timer);
      if (value) trackerCache.set(areaId, value);
      resolve(value);
    };
    const stop = bridge.onEvent((raw) => {
      const event = trackerTypesResult.safeParse(raw);
      if (!event.success || event.data.workAreaId !== areaId) return;
      const { project, story, task, needs } = event.data;
      finish(project && story ? { project, story, task, needs } : null);
    });
    const timer = setTimeout(() => finish(null), 2500);
    bridge.send({ version: 1, kind: "tracker-types", workAreaId: areaId });
  });
}
/**
 * The stored reason behind each plan item that was not created, read from the
 * service once per turn. A slow or missing answer only means Firstmate is not
 * told that reason.
 */
function askFailureReasons(plans: PlanEntry[]) {
  const wanted = plans.filter((plan) =>
    plan.results.some((result) => result.state !== "created"),
  );
  if (!wanted.length) return Promise.resolve<Record<string, string>>({});
  return new Promise<Record<string, string>>((resolve) => {
    const reasons: Record<string, string> = {};
    const waiting = new Set(wanted.map((plan) => plan.id));
    const finish = () => {
      stop();
      clearTimeout(timer);
      resolve(reasons);
    };
    const stop = bridge.onEvent((raw) => {
      const event = planPlacesResult.safeParse(raw);
      if (!event.success || !waiting.delete(event.data.planId)) return;
      for (const place of event.data.places)
        if (place.failure)
          reasons[`${event.data.planId}:${place.id}`] = place.failure;
      if (!waiting.size) finish();
    });
    const timer = setTimeout(finish, 2500);
    for (const plan of wanted)
      bridge.send({ version: 1, kind: "plan-places", planId: plan.id });
  });
}
const trackerLine = (types: TrackerTypes | null) =>
  types
    ? `In ${types.project}, stories are ${countedNoun(2, types.story).slice(2)}${types.task ? ` and sub-tasks are ${countedNoun(2, types.task).slice(2)}` : ""}. Leave the type out of Azure DevOps plan items unless the owner names one or asks for a sub-task under an existing item (then use the sub-task type and the parent field); Amun uses the project's own.${types.needs
        .map(
          (need) =>
            ` ${types.project} requires ${need.fields.join(", ")} for ${countedNoun(2, need.type).slice(2)}: ask the owner for ${need.fields.length === 1 ? "that value" : "those values"} before proposing the item (list the allowed values for any field that has them), then put each in the item's fields under its name (the words before any bracket). Estimates and hours such as Remaining Work are plain numbers. Never choose one yourself.`,
        )
        .join("")}`
    : "";

type PlanEntry = Snapshot["plans"][number];
function PlanItem({
  plan,
  item,
  place,
}: {
  plan: PlanEntry;
  item: PlanEntry["items"][number];
  place: Place | undefined;
}) {
  const result = plan.results.find((entry) => entry.id === item.id);
  const destination =
    place?.destination ??
    (typeof item.fields.destination === "string"
      ? item.fields.destination
      : plan.destination);
  const fields = Object.entries(item.fields)
    .filter(
      ([key, value]) => key !== "destination" && value !== null && value !== "",
    )
    .map(
      ([key, value]) =>
        `${key.charAt(0).toUpperCase()}${key.slice(1)}: ${value}`,
    )
    .join(" · ");
  const parent = place?.parent;
  const settled = plan.state !== "proposed" && plan.state !== "approved";
  return (
    <span style={{ display: "grid", gap: 4 }}>
      <span style={{ fontWeight: 600 }}>{item.summary}</span>
      {plan.kind !== "roadmap" && !result && (
        <>
          <span className="row wrap small">
            <span className="tag">{trackerName(destination)}</span>
            {place?.kind && <span className="tag">{place.kind}</span>}
            {place?.place && <span className="muted">{place.place}</span>}
            {place?.problem && (
              <span style={{ color: "var(--amun-status-signed-out)" }}>
                {place.problem}
              </span>
            )}
          </span>
          {parent && !parent.problem && (
            <span className="small">
              Under #{parent.id}
              {parent.title ? ` · ${parent.title}` : ""}
            </span>
          )}
          {place?.sentAs && <span className="small muted">{place.sentAs}</span>}
          {place?.existing && (
            <span className="small" role="status">
              <span className="tag warn">Already there</span>{" "}
              {`Already in ${trackerName(destination)} as ${/^\d+$/.test(place.existing.id) ? "#" : ""}${place.existing.id} — approving will link, not create.`}
            </span>
          )}
          {place?.change ? (
            <span
              className="small prd-diff"
              role="group"
              aria-label="What will change"
              style={{ display: "grid", gap: 2, whiteSpace: "pre-wrap" }}
            >
              {place.change.map((line, index) =>
                line.kind === "add" ? (
                  <ins key={index}>{"+ " + line.text}</ins>
                ) : line.kind === "remove" ? (
                  <del key={index}>{"− " + line.text}</del>
                ) : (
                  <span key={index} className="muted">
                    {"  " + line.text}
                  </span>
                ),
              )}
            </span>
          ) : place?.content ? (
            <span
              className="small"
              role="group"
              aria-label="Exactly what the page will say"
              tabIndex={0}
              style={{
                display: "block",
                whiteSpace: "pre-wrap",
                maxHeight: 220,
                overflowY: "auto",
              }}
            >
              {place.content}
            </span>
          ) : (
            <span className="muted small">{fields || "No field changes"}</span>
          )}
        </>
      )}
      {result?.state === "created" && (
        <span className="row wrap small">
          <span className="tag good">
            {result.linked
              ? "Already exists"
              : result.updated
                ? "Updated"
                : "Created"}
            {result.externalId && /^\d+$/.test(result.externalId)
              ? " #" + result.externalId
              : ""}
          </span>
          {result.linked && (
            <span className="muted">Linked, not created again.</span>
          )}
          {place?.note && <span className="muted">{place.note}</span>}
          {result.url && (
            <button
              className="link"
              onClick={() =>
                bridge.send({
                  version: 1,
                  kind: "plan-open",
                  planId: plan.id,
                  itemId: item.id,
                })
              }
            >
              Open in {trackerName(destination)}
            </button>
          )}
        </span>
      )}
      {result && result.state !== "created" && (
        <>
          <span className="row wrap small">
            <span
              className={
                "tag " +
                (result.state === "failed" && !place?.changedInNotion
                  ? "bad"
                  : "warn")
              }
            >
              {place?.changedInNotion
                ? "Changed in Notion"
                : result.state === "failed"
                  ? place?.kind?.endsWith("update")
                    ? "Not updated"
                    : "Not created"
                  : "Being checked"}
            </span>
            <span className="muted" role="status">
              {place?.changedInNotion
                ? "Changed in Notion since Amun last wrote it. Nothing was overwritten."
                : result.state === "failed"
                  ? (place?.failure ??
                    place?.problem ??
                    `${trackerName(destination)} did not accept this. Nothing was duplicated.`)
                  : `${trackerName(destination)} did not confirm. Amun looks for it before sending anything again.`}
            </span>
          </span>
          {settled && place?.changedInNotion && (
            <span>
              <button
                className="btn"
                onClick={() =>
                  bridge.send({
                    version: 1,
                    kind: "plan-open",
                    planId: plan.id,
                    itemId: item.id,
                  })
                }
              >
                Review the newer version
              </button>
            </span>
          )}
          {settled && !place?.changedInNotion && (
            <span>
              <button
                className="btn"
                onClick={() =>
                  bridge.send({
                    version: 1,
                    kind: "plan-publish",
                    planId: plan.id,
                    ...(result.state === "failed" ? { retry: true } : {}),
                  })
                }
              >
                {result.state === "failed" ? "Retry" : "Check now"}
              </button>
            </span>
          )}
        </>
      )}
    </span>
  );
}

function PlanReview({
  snapshot,
  planId,
}: {
  snapshot: Snapshot;
  planId: string;
}) {
  const plan = snapshot.plans.find((item) => item.id === planId);
  // What the user saw when the review opened. Approval is bound to it.
  const [seen, setSeen] = useState(plan?.fingerprint ?? "");
  const [skipped, setSkipped] = useState<string[]>([]);
  const places = usePlaces(planId, plan?.fingerprint ?? "");
  if (!plan) return <p className="muted">That plan is no longer available.</p>;
  const changed = plan.state === "proposed" && seen !== plan.fingerprint;
  // The real work item type, when every item goes to one the project names.
  const realType = planNoun(
    plan.items.map((item) => ({
      kind: places.find((entry) => entry.id === item.id)?.kind,
      fields: item.fields,
    })),
  );
  const noun = realType ?? (plan.kind === "stories" ? "story" : "change");
  const proposed = plan.state === "proposed";
  const ticked = plan.items.filter((item) => !skipped.includes(item.id));
  // Items left out of an earlier approval of this plan, still waiting.
  const waiting = snapshot.plans.filter(
    (item) => item.splitFrom === plan.id && item.state === "proposed",
  );
  const pick = proposed && plan.items.length > 1;
  // A parent that cannot be read, or is still being checked, blocks approval.
  const parentBlocked = ticked.some((item) => {
    if (!adoParentOf(item.fields).named) return false;
    const entry = places.find((place) => place.id === item.id);
    if (entry && entry.destination !== "ado") return false;
    return !entry?.parent || !!entry.parent.problem;
  });
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2 style={{ fontSize: 20 }}>{plan.summary || "Proposed changes"}</h2>
      <p className="muted">
        To {planDestinations(plan)} ·{" "}
        {realType
          ? countedNoun(plan.items.length, realType)
          : `${plan.items.length} ${plan.items.length === 1 ? "item" : "items"}`}{" "}
        · {planStateNote(plan.state, plan.destination)}
      </p>
      <div style={{ display: "grid", gap: 14 }}>
        {plan.items.map((item) => {
          const body = (
            <PlanItem
              plan={plan}
              item={item}
              place={places.find((entry) => entry.id === item.id)}
            />
          );
          return pick ? (
            <label
              key={item.id}
              className="row"
              style={{ gap: 10, alignItems: "flex-start", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                style={{ marginTop: 4, width: 15, height: 15 }}
                checked={!skipped.includes(item.id)}
                onChange={(event) =>
                  setSkipped(
                    event.target.checked
                      ? skipped.filter((id) => id !== item.id)
                      : [...skipped, item.id],
                  )
                }
              />
              {body}
            </label>
          ) : (
            <div key={item.id}>{body}</div>
          );
        })}
        {waiting.flatMap((left) =>
          left.items.map((item) => (
            <div key={item.id} style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 600 }}>{item.summary}</span>
              <span className="row wrap small">
                <span className="tag">Not approved yet</span>
                <span className="muted">
                  {trackerName(
                    typeof item.fields.destination === "string"
                      ? item.fields.destination
                      : left.destination,
                  )}{" "}
                  · still waiting under Needs your attention
                </span>
              </span>
              <span className="row">
                <button
                  className="btn"
                  onClick={() =>
                    work("approve-plan", {
                      planId: left.id,
                      fingerprint: left.fingerprint,
                      itemIds: [item.id],
                    })
                  }
                >
                  Approve and publish
                </button>
                <button
                  className="btn quiet"
                  onClick={() =>
                    left.items.length === 1
                      ? work("request-changes", { planId: left.id })
                      : work("update-plan", {
                          planId: left.id,
                          items: left.items.filter(
                            (entry) => entry.id !== item.id,
                          ),
                        })
                  }
                >
                  Remove from plan
                </button>
              </span>
            </div>
          )),
        )}
      </div>
      {proposed && (
        <div style={{ display: "grid", gap: 8 }}>
          {changed && (
            <p className="rb-notice" role="status">
              <span>
                This plan changed after you opened it. Review the current
                version before approving.
              </span>
              <button className="btn" onClick={() => setSeen(plan.fingerprint)}>
                I’ve reviewed it
              </button>
            </p>
          )}
          <div className="row">
            <button
              className="btn primary"
              disabled={changed || !ticked.length || parentBlocked}
              onClick={() =>
                work("approve-plan", {
                  planId: plan.id,
                  fingerprint: seen,
                  ...(ticked.length < plan.items.length
                    ? { itemIds: ticked.map((item) => item.id) }
                    : {}),
                })
              }
            >
              {ticked.length < plan.items.length
                ? `Approve and publish ${ticked.length} of ${plan.items.length}`
                : approveLabel(plan.items.length, noun)}
            </button>
            <button className="btn" onClick={() => requestPlanChanges(plan)}>
              Request changes
            </button>
          </div>
          <p className="muted small">
            {pick
              ? "Approval covers exactly the ticked items. An unticked item is not approved and stays here waiting for you."
              : "Approval covers exactly the items listed here. Anything added later is asked again."}
          </p>
        </div>
      )}
      {plan.state === "changes_requested" && (
        <p className="muted">
          You asked for changes. Firstmate will bring back a new proposal.
        </p>
      )}
    </div>
  );
}

export function OutputDoc({
  snapshot,
  areaId,
  outputId,
  editing,
  onAsk,
  onPreview,
  citations,
}: {
  snapshot: Snapshot;
  areaId: string;
  outputId: string;
  editing: boolean;
  onAsk(text: string): void;
  onPreview?(url: string): void;
  citations?: Citations;
}) {
  const item = snapshot.library.find((entry) => entry.id === outputId);
  const [previewing, setPreviewing] = useState(false);
  const [previewNotice, setPreviewNotice] = useState("");
  const waiting = useRef("");
  useEffect(
    () =>
      bridge.onEvent((raw) => {
        const result = previewResult.safeParse(raw);
        if (!result.success || result.data.id !== waiting.current) return;
        waiting.current = "";
        setPreviewing(false);
        setPreviewNotice(result.data.url ? "" : result.data.message);
        if (result.data.url) onPreview?.(result.data.url);
      }),
    [onPreview],
  );
  useEffect(() => {
    waiting.current = "";
    setPreviewing(false);
    setPreviewNotice("");
  }, [outputId]);
  const [body, setBody] = useState(item?.body ?? "");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setBody(item?.body ?? ""), [outputId]);
  useEffect(() => {
    // The saved copy has caught up with what was typed.
    if (item && draftBodies.get(item.id) === item.body)
      draftBodies.delete(item.id);
  }, [item?.body]);
  if (!item)
    return <p className="muted">That item is no longer in the Library.</p>;
  const record = item.section === "record";
  const approval = approvalOf(item);
  const unknownItems = checklistSummary(body).unknown;
  const openable =
    !editing && !!onPreview && previewSource(item.type, item.body) !== null;
  const save = (next: string) => {
    if (record || next === item.body) return;
    work("save-output", {
      outputId: item.id,
      groupId: item.groupId,
      type: item.type,
      title: item.title,
      body: next,
      status: item.status,
      workAreaIds: item.workAreaIds,
    });
  };
  const insert = (make: string | ((before: string) => string)) => {
    const element = area.current;
    if (!element) return;
    const at = element.selectionStart;
    const snippet = typeof make === "function" ? make(body.slice(0, at)) : make;
    const next = body.slice(0, at) + snippet + body.slice(element.selectionEnd);
    setBody(next);
    save(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(at + snippet.length, at + snippet.length);
    });
  };
  return (
    <>
      <div style={{ display: "grid", gap: 12 }}>
        <div className="row wrap">
          <span className="tag">{typeName(item.type)}</span>
          <span className={"tag" + (item.needsLinking ? " warn" : "")}>
            {item.status}
          </span>
          {approval.state !== "none" && (
            <span
              className={"tag" + (approval.state === "changed" ? " warn" : "")}
            >
              {approvalLabel(approval)}
            </span>
          )}
          {item.acceptance && (
            <span
              className={
                "tag" +
                (item.acceptance.decision !== "accepted" ||
                item.version > item.acceptance.version
                  ? " warn"
                  : "")
              }
            >
              {acceptanceLabel(item)}
            </span>
          )}
          {item.type === acceptanceType && unknownItems > 0 && (
            <span className="tag warn">
              {unknownItems === 1
                ? "1 item has no evidence yet"
                : `${unknownItems} items have no evidence yet`}
            </span>
          )}
          {!item.workAreaIds.includes(areaId) && (
            <span className="tag">From the Library</span>
          )}
        </div>
        {openable && (
          <div className="row">
            <button
              className="btn quiet"
              disabled={previewing}
              onClick={() => {
                waiting.current = crypto.randomUUID();
                setPreviewing(true);
                setPreviewNotice("");
                bridge.send({
                  version: 1,
                  kind: "output-preview",
                  id: waiting.current,
                  outputId: item.id,
                });
              }}
            >
              Open preview
            </button>
            <span className="note" role="status">
              {previewing ? "Opening the preview…" : previewNotice}
            </span>
          </div>
        )}
        {!editing ? (
          <MarkdownDoc
            body={body}
            disabled={record}
            {...(citations ? { citations } : {})}
            onToggle={(line) => {
              const next = toggleTask(body, line);
              setBody(next);
              draftBodies.set(item.id, next);
              save(next);
            }}
          />
        ) : (
          <textarea
            ref={area}
            aria-label={item.title}
            readOnly={record}
            value={body}
            placeholder={
              record ? "" : "Start writing, or ask Firstmate to draft this."
            }
            onChange={(event) => {
              setBody(event.target.value);
              draftBodies.set(item.id, event.target.value);
            }}
            onBlur={() => save(body)}
          />
        )}
      </div>
      {record && (
        <form
          className="rb-inline"
          style={{ marginTop: 16 }}
          onSubmit={(event) => {
            event.preventDefault();
            const field = event.currentTarget.elements.namedItem(
              "finding",
            ) as HTMLInputElement;
            if (!field.value.trim()) return;
            work("save-finding", {
              recordId: item.id,
              text: field.value.trim(),
              workAreaIds: [areaId],
            });
            field.value = "";
          }}
        >
          <label className="field">
            Propose something from this record as work here
            <input
              name="finding"
              type="text"
              maxLength={400}
              placeholder="e.g. Bulk upload for onboarding"
            />
          </label>
          <div className="row">
            <button className="btn">Propose for review</button>
            <span className="note">
              Nothing reaches a backlog or roadmap until you approve it.
            </span>
          </div>
        </form>
      )}
      {editing && !record && (
        <div className="rb-toolbar" role="toolbar" aria-label="Document tools">
          <button onClick={() => insert("\n## Heading\n")}>Text</button>
          <button onClick={() => insert(tableSnippet)}>Table</button>
          <button onClick={() => insert("\n- [ ] ")}>Checklist</button>
          <button
            className="ask"
            onClick={() => onAsk(`About “${item.title}”: `)}
          >
            Ask Firstmate
          </button>
        </div>
      )}
    </>
  );
}

const stopsKey = "amun.fork-stops";
function readSettledStops(): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(stopsKey) ?? "[]") as unknown;
    return Array.isArray(kept) ? kept.map(String).slice(-200) : [];
  } catch {
    return [];
  }
}
function writeSettledStops(value: string[]) {
  try {
    localStorage.setItem(stopsKey, JSON.stringify(value.slice(-200)));
  } catch {
    // Best effort: the card may be offered once more after a restart.
  }
}

/** The quiet icon row under a message: copy, and "Fork from here". */
function MessageActions({
  text,
  onFork,
}: {
  text: string;
  onFork(): void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);
  return (
    <div className="rb-msg-acts">
      <button
        className="icon-btn"
        aria-label={copied ? "Copied" : "Copy"}
        onClick={async () => {
          if (!(await copyText(text))) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Icon name={copied ? "check" : "copy"} width={15} height={15} />
        <span className="tip" role="tooltip">
          <strong>{copied ? "Copied" : "Copy"}</strong>
        </span>
      </button>
      <button
        className="icon-btn"
        aria-label="Fork from here"
        disabled={forking}
        onClick={async () => {
          setForking(true);
          await onFork();
          setForking(false);
        }}
      >
        <Icon name="fork" width={15} height={15} />
        <span className="tip" role="tooltip">
          <strong>Fork from here</strong>
          Starts a new chat from this point. This one stays as it is.
        </span>
      </button>
    </div>
  );
}

/**
 * What a chat shows where a message is waiting on "where should this go?",
 * or where its messages were moved to another folder.
 */
function MoveLine({
  card,
  onOpen,
}: {
  card: unknown;
  onOpen(areaId: string, chatId: string | null): void;
}) {
  const offer = asMoveOffer(card);
  const moved = asMovedLine(card);
  const to = moved
    ? {
        workAreaId: moved.toWorkAreaId,
        chatId: moved.toChatId,
        name: moved.name,
      }
    : offer?.state === "moved"
      ? (offer.to ?? null)
      : null;
  if (to)
    return (
      <p className="muted small">
        Continued in <strong>{to.name}</strong>.{" "}
        <button
          className="link"
          onClick={() => onOpen(to.workAreaId, to.chatId)}
        >
          Open
        </button>
      </p>
    );
  if (offer?.state === "open" && offer.held !== null)
    return (
      <div className="rb-turn you">
        <div className="rb-msg you held">{offer.held}</div>
        <span className="rb-held-note">
          Not sent yet. Firstmate’s card on the left asks where it goes.
        </span>
      </div>
    );
  return null;
}

export function WorkSession({
  snapshot,
  workspace,
  areaId,
  chatId,
  now,
  model,
  pane,
  ratio,
  expanded,
  first,
  onChat,
  onWork,
  onPane,
  onResize,
  onExpand,
  onGroupNeeded,
  onSettings,
  focus = null,
  onBackToResults = null,
}: {
  snapshot: Snapshot;
  workspace: WorkspaceSnapshot | null;
  areaId: string;
  /** A fork inside this work; null is the main chat. */
  chatId: string | null;
  now: number;
  model: string | null;
  pane: PaneTarget;
  ratio: number;
  expanded: boolean;
  /** A message typed on Home that opened this session. */
  first: string | null;
  /** Opens another chat of this work (after "Fork from here"). */
  onChat(chatId: string | null): void;
  /** Opens a chat in another folder, optionally sending it a first message. */
  onWork(areaId: string, chatId: string | null, first?: string): void;
  onPane(target: PaneTarget): void;
  onResize(ratio: number): void;
  onExpand(): void;
  onGroupNeeded(): void;
  onSettings(): void;
  /** Open at a passage (search, Open reply) or where reading stopped. */
  focus?: ReadingFocus | null;
  /** Back to the search results this chat was opened from. */
  onBackToResults?: (() => void) | null;
}) {
  const mainContext = workContext(snapshot, areaId, now);
  const chat = chatId
    ? (snapshot.chats.find(
        (item) => item.id === chatId && item.workAreaId === areaId,
      ) ?? null)
    : null;
  // A fork shows and continues its own messages; everything else about the
  // work (its documents, plans, blockers) is shared with the main chat.
  const context =
    mainContext && chat
      ? { ...mainContext, messages: chat.messages }
      : mainContext;
  // Messages written from here are saved in the chat this session was opened
  // on, also when a reply arrives after the owner has moved to another chat.
  const savedIn = chat?.id ?? null;
  // A message that is waiting or out belongs to the chat it was typed in, so
  // another chat of the same work never picks it up or answers it.
  const threadKey = savedIn ? `${areaId}:${savedIn}` : areaId;
  // The chat as the sidebar and Amun's memory of it know it.
  const entryKey = chatKey(areaId, savedIn);
  const work = ((action: string, payload?: object) =>
    storeWork(
      action as never,
      (action === "message"
        ? { ...payload, chatId: savedIn }
        : payload) as never,
    )) as typeof storeWork;
  const workAsync = ((action: string, payload?: object) =>
    storeWorkAsync(
      action as never,
      (action === "message"
        ? { ...payload, chatId: savedIn }
        : payload) as never,
    )) as typeof storeWorkAsync;
  // The failure's own details are its plan's per-item reasons.
  const failureRef = context?.failure?.ref;
  const failurePlanId = failureRef?.startsWith("failure:")
    ? failureRef.slice(8)
    : null;
  const failurePlan = snapshot.plans.some((plan) => plan.id === failurePlanId)
    ? failurePlanId
    : null;
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [menu, setMenu] = useState<"title" | "mode" | "area" | "fail" | null>(
    null,
  );
  const [editing, setEditing] = useState(true);
  const [renaming, setRenaming] = useState(false);
  /** The decision being written for a checklist; its reason is asked first. */
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [decisionProblem, setDecisionProblem] = useState("");
  /** Version history of the open document: the list ("list") or one version. */
  const [history, setHistory] = useState<"list" | number | null>(null);
  const titleRoot = useRef<HTMLElement>(null);
  // Where "What happened" puts its Previous step, Next step and Fold all.
  const [happenedControls, setHappenedControls] = useState<HTMLElement | null>(
    null,
  );
  useDismiss(menu === "title", titleRoot, () => setMenu(null));
  const openDocument = pane?.kind === "output" ? pane.id : null;
  const openVersion = pane?.kind === "output" ? (pane.version ?? null) : null;
  useEffect(() => {
    setMenu((current) => (current === "title" ? null : current));
    // An older version is opened as itself, never as the latest.
    const item = snapshot.library.find((entry) => entry.id === openDocument);
    setHistory(
      openVersion !== null && item && openVersion !== item.version
        ? openVersion
        : null,
    );
    setDeciding(null);
    setDecisionProblem("");
  }, [openDocument, openVersion]);
  const [dragging, setDragging] = useState(false);
  // Reply cards the owner already answered or set aside.
  const [closedAsks, setClosedAsks] = useState<string[]>([]);
  const azureConnected = useAzureConnected();
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(
    null,
  );
  const [problem, setProblem] = useState("");
  const [copiedLog, setCopiedLog] = useState("");
  /** The name being typed while this work is renamed; null when it is not. */
  const [areaName, setAreaName] = useState<string | null>(null);
  /** The client being typed for a project; null when it is not. */
  const [clientDraft, setClientDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const latestReply = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const sentFirst = useRef<string | null>(null);
  /** The owner's latest words, so a brief can carry the length they asked for. */
  const lastRequest = useRef("");

  /** Cited sources open in the panes Amun already has; nothing is written. */
  const productId = context?.area.productId ?? null;
  const productSources =
    productId && workspace?.productContext?.productId === productId
      ? workspace.productContext.sources
      : [];
  const citations: Citations = {
    context: citationContext({
      items: snapshot.library,
      sources: productSources,
      preferredSourceId: productId
        ? readSource(
            browserStore(),
            productId,
            productSources.filter((s) => s.kind === "ado").map((s) => s.id),
          )
        : "",
    }),
    onOpen: (cite: Cite) =>
      onPane(
        cite.kind === "output"
          ? { kind: "output", id: cite.id }
          : cite.kind === "web"
            ? { kind: "browser", url: cite.url }
            : { kind: "prd" },
      ),
  };

  // What Firstmate asked for in its own reply is never told back to it.
  const toldWork = ((action: string, payload?: object) =>
    work(action as never, { ...payload, told: true } as never)) as typeof work;
  const toldWorkAsync = ((action: string, payload?: object) =>
    workAsync(
      action as never,
      { ...payload, told: true } as never,
    )) as typeof workAsync;
  /** Files what Firstmate proposed under this work area. Proposals only. */
  const raise = (proposed: AmunAction) => {
    const work = toldWork;
    const workAsync = toldWorkAsync;
    const groupId = context?.area.groupId ?? null;
    // Documents are saved by "apply-reply", which links them to their
    // request when the reference matches.
    if (proposed.do === "document") return;
    if (proposed.do === "plan")
      void (async () => {
        const result = await workAsync("propose-plan", {
          groupId: null,
          workAreaId: areaId,
          planKind: proposed.planKind,
          destination: proposed.destination,
          summary: proposed.summary,
          items: proposed.items.map((item) => ({
            id: crypto.randomUUID(),
            ...item,
          })),
        });
        // A refused plan never exists, so say so here; Firstmate is told with
        // the owner's next message (see agentNews).
        if (!result.ok)
          work("message", {
            workAreaId: areaId,
            role: "firstmate",
            text: `Nothing was raised for your approval. ${result.message}`,
            card: { kind: "plan-refused" },
          });
      })();
    else if (proposed.do === "move") {
      // Firstmate thinks the latest messages belong in another folder. The
      // owner is asked on Firstmate's card; nothing moves without their yes.
      const snap = latest.current.snapshot;
      const here = snap.areas.find((item) => item.id === areaId);
      const said = (
        savedIn
          ? (snap.chats.find((item) => item.id === savedIn)?.messages ?? [])
          : snap.messages.filter((item) => item.workAreaId === areaId)
      ) as { id: string; role: string; card: unknown }[];
      const from = said
        .filter((item) => item.role === "you")
        .at(-proposed.messages);
      const twin = snap.areas.find(
        (item) =>
          item.name !== generalConversationName &&
          sameWorkName(item.name, proposed.name),
      );
      const asking = said.some(
        (item) => asMoveOffer(item.card)?.state === "open",
      );
      if (
        here &&
        from &&
        !asking &&
        twin?.id !== areaId &&
        !here.keptHere.some((kept) => sameWorkName(kept, proposed.name))
      ) {
        const offer: MoveOffer = {
          kind: "move-offer",
          state: "open",
          held: null,
          fromMessageId: from.id,
          request: {
            type: proposed.type,
            name: proposed.name,
            priority: null,
            dueDate: null,
          },
          existingAreaId: twin?.id ?? null,
          workAreaId: areaId,
          chatId: savedIn,
        };
        void askWhereItGoes(
          offer,
          moveQuestion(offer, here.name, twin?.name ?? null),
          here.groupId,
        );
      }
    } else if (proposed.do === "question" || proposed.do === "offer")
      work("attention", {
        attentionKind: proposed.do,
        groupId: null,
        workAreaId: areaId,
        title: proposed.title,
        detail: proposed.detail,
        options: proposed.do === "question" ? proposed.options : [],
      });
    else if (proposed.do === "scope")
      work("message", {
        workAreaId: areaId,
        role: "card",
        text: proposed.item,
        card: { kind: "scope", item: proposed.item, brd: proposed.brd },
      });
    else if (proposed.do === "title") {
      // Only the first reply names a chat, and the owner's own name wins.
      if (!context?.messages.some((message) => message.role === "firstmate"))
        work("suggest-chat-title", {
          workAreaId: areaId,
          chatId: savedIn,
          title: proposed.text,
        });
    } else if (proposed.do === "rename")
      // Done at once: it stays inside Amun and is undone by renaming again.
      work("update-area", { areaId, patch: { name: proposed.name } });
    else if (proposed.do === "client") {
      // Inside Amun and undone by setting it again; only projects have one.
      if (context?.area.type === "project")
        work("update-area", { areaId, patch: { client: proposed.name } });
    } else if (proposed.do === "repo") {
      // Read-only mapping on this Mac; merging stays a governed plan.
      const pid = context?.area.productId ?? null;
      const mapped = workspace?.productContext;
      if (pid && mapped?.productId === pid) {
        if (!mapped.sources.some((s) => s.reference === proposed.url))
          bridge.send({
            version: 1,
            kind: "workspace",
            action: "map-source",
            productId: pid,
            sourceKind: "repo",
            title: proposed.url.split("/").slice(-2).join("/").slice(0, 512),
            reference: proposed.url,
          });
      } else
        work("message", {
          workAreaId: areaId,
          role: "firstmate",
          text: "Open Pull requests once, then ask me again to connect the repository.",
        });
    } else if (proposed.do === "objective" || proposed.do === "objective-link")
      void (async () => {
        // Inside Amun: saved at once, and its links stay in this group.
        const snap = latest.current.snapshot;
        const groupId = context?.area.groupId ?? null;
        const reply = (text: string) =>
          work("message", { workAreaId: areaId, role: "firstmate", text });
        const named = (names: string[]) => {
          const found: string[] = [];
          const missing: string[] = [];
          for (const name of names) {
            const area = findNamed(
              snap.areas.filter((item) => item.groupId === groupId),
              name,
              (item) => item.name,
            );
            if (area) found.push(area.id);
            else missing.push(name);
          }
          return { found, missing };
        };
        const { found, missing } = named(proposed.areas);
        const note = missing.length
          ? ` I could not tell which work you meant by ${missing.map((name) => `“${name}”`).join(", ")}, so I did not link it. Say a few words from its name.`
          : "";
        if (!groupId) {
          reply(
            "Choose a group for this work first, then I can track an objective for it.",
          );
          return;
        }
        if (proposed.do === "objective") {
          await workAsync("save-objective", {
            groupId,
            metric: proposed.title,
            baseline: proposed.baseline,
            target: proposed.target,
            current: proposed.baseline,
            dueDate: proposed.due,
            workAreaIds: [...new Set([areaId, ...found])],
          });
          if (note) reply(note.trim());
          return;
        }
        const objective = findNamed(
          snap.objectives.filter((item) => item.groupId === groupId),
          proposed.objective,
          (item) => item.metric,
        );
        if (!objective) {
          reply(
            `I could not tell which objective you meant by “${proposed.objective}”. Say a few words from its title.`,
          );
          return;
        }
        await workAsync("save-objective", {
          objectiveId: objective.id,
          groupId,
          metric: objective.metric,
          baseline: objective.baseline,
          target: objective.target,
          current: objective.current,
          evidenceDate: objective.evidenceDate,
          reviewDate: objective.reviewDate,
          dueDate: objective.dueDate,
          conflict: objective.conflict,
          workAreaIds: [...new Set([...objective.links, ...found])],
        });
        if (note) reply(note.trim());
      })();
    else if (
      proposed.do === "blocker" ||
      proposed.do === "blocker-owner" ||
      proposed.do === "unblock"
    ) {
      // Inside Amun, like a rename: recorded at once and changed by saying so.
      const open = openBlockers(latest.current.snapshot.blockers, areaId);
      if (proposed.do === "blocker")
        work("raise-blocker", {
          areaId,
          title: proposed.title,
          owner: proposed.owner,
        });
      else {
        const found = findBlocker(open, proposed.blocker);
        if (!found)
          work("message", {
            workAreaId: areaId,
            role: "firstmate",
            text: `I could not tell which blocker you meant by “${proposed.blocker}”. Say a few words from its title.`,
          });
        else if (proposed.do === "unblock")
          work("resolve-blocker", { blockerId: found.id });
        else
          work("set-blocker-owner", {
            blockerId: found.id,
            owner: proposed.owner,
          });
      }
    } else if (
      proposed.do === "fact-correct" ||
      proposed.do === "fact-forget"
    ) {
      // Inside Amun, like a rename: changed at once and undone by saying so.
      const snap = latest.current.snapshot;
      const found = findFact(
        factsFor(snap, context?.area.groupId ?? null),
        proposed.fact,
      );
      if (!found)
        work("message", {
          workAreaId: areaId,
          role: "firstmate",
          text: `I could not tell which remembered fact you meant by “${proposed.fact}”. Say a few words from it.`,
        });
      else if (proposed.do === "fact-forget")
        work("forget-claim", { claimId: found.id });
      else work("correct-claim", { claimId: found.id, value: proposed.value });
    } else if (proposed.do === "convert")
      void (async () => {
        const name = context?.area.name ?? "This";
        // Same record, same id: the conversation and its links stay put.
        const result =
          context?.area.type === "task"
            ? await workAsync("convert-task", { areaId, convert: true })
            : null;
        work("message", {
          workAreaId: areaId,
          role: "firstmate",
          text: !result
            ? `“${name}” is not a task, so there is nothing to convert.`
            : result.ok
              ? `Done. “${name}” is now a project. Its conversation, history, links, objective and tracker are kept, and nothing outside Amun was changed.`
              : `I could not convert “${name}”. ${result.message}`,
        });
      })();
    else if (proposed.do === "delegate")
      // The service starts the worker; the result returns to this chat.
      bridge.send({
        version: 1,
        kind: "work-delegate",
        workAreaId: areaId,
        agent: proposed.agent,
        title: proposed.title,
        task: delegationTask(proposed.task, lastRequest.current),
        ...(proposed.acceptance ? { acceptance: true } : {}),
        ...(proposed.repo ? { repo: proposed.repo } : {}),
      });
    else if (proposed.do === "delete")
      // Deleting is the owner's call: Firstmate can only ask.
      work("message", {
        workAreaId: areaId,
        role: "card",
        text: "Delete this work?",
        card: { kind: "delete-work" },
      });
    else if (proposed.do === "update") {
      // Every open blocker goes in with its owner and age, as of now.
      const stuck = blockerUpdateLines(
        openBlockers(latest.current.snapshot.blockers, areaId),
        Date.now(),
      );
      const message = stuck.length
        ? `${proposed.message}\n\n${stuck.join("\n")}`
        : proposed.message;
      work("message", {
        workAreaId: areaId,
        role: "card",
        text: message,
        card: { kind: "update", message },
      });
    } else if (groupId)
      work("rule-case", {
        groupId,
        situation: proposed.situation,
        resolution: proposed.resolution,
        eventId: crypto.randomUUID(),
      });
  };
  const queue = useSyncExternalStore(observeHeldMessages, () =>
    heldQueue(threadKey),
  );
  const waiting = queue[0];
  /** Sends one turn to Firstmate. The user's message is already in the thread. */
  const deliver = async (
    text: string,
    scoped: string,
    activityId: string | null = null,
    image?: string,
    /** A message that was already waiting stays waiting unless it is sent. */
    retry = false,
    /** This turn carries Amun's rules for a conversation that lacked them. */
    briefing = false,
    ref?: string,
  ) => {
    if (!retry && (inFlight.has(threadKey) || heldMessage(threadKey))) {
      // A turn is still out (for example a waiting message being retried):
      // a new message waits behind it instead of being dropped.
      holdMessage(threadKey, {
        text,
        scoped,
        activityId,
        image,
        reason: "busy",
        ref,
      });
      return;
    }
    inFlight.add(threadKey);
    // Once claimed for dispatch, this message is no longer queued. The
    // original message remains in chat even if its receipt is interrupted.
    if (retry) releaseMessage(threadKey);
    setProblem("");
    setBusy(true);
    const label = text.length > 80 ? text.slice(0, 77) + "…" : text;
    const row =
      activityId ??
      (
        await workAsync("activity", {
          groupId: null,
          workAreaId: areaId,
          text: label,
          state: "running",
        })
      ).ref;
    // The chat's row shows that Firstmate is writing, only while it is.
    setWriting(entryKey, true);
    const turn = await askFirstmate(scoped, image).catch((error: unknown) => ({
      ok: false as const,
      needsProvider: false,
      reason:
        error instanceof Error ? error.message : "Firstmate could not answer.",
    }));
    setWriting(entryKey, false);
    if (turn.ok) {
      const parsed = parseAmunActions(turn.reply);
      const renamed = parsed.actions.find((item) => item.do === "rename");
      const client = parsed.actions.find((item) => item.do === "client");
      const blocked = parsed.actions.find((item) => item.do === "blocker");
      const tracked = parsed.actions.find(
        (item) => item.do === "objective" || item.do === "objective-link",
      );
      const remembered = parsed.actions.find(
        (item) => item.do === "fact-correct" || item.do === "fact-forget",
      );
      // A rename always gets a plain confirmation, even from a silent reply.
      const handed = parsed.actions.flatMap((item) =>
        item.do === "delegate" ? [`${item.agent} is on “${item.title}”.`] : [],
      );
      const said =
        parsed.text ||
        (renamed?.do === "rename"
          ? `Done. This is now called “${renamed.name}”.`
          : client?.do === "client" && context?.area.type === "project"
            ? client.name
              ? `Done. The client is now ${client.name}.`
              : "Done. The client is cleared."
            : tracked?.do === "objective"
              ? `Saved. I am tracking “${tracked.title}”${tracked.baseline === null ? "; its starting point is unknown" : ""}.`
              : tracked?.do === "objective-link"
                ? "Done. I have linked that objective."
                : blocked?.do === "blocker"
                  ? `Noted. “${blocked.title}” is blocked${blocked.owner ? `, and ${blocked.owner} owns unblocking it` : ", and nobody owns unblocking it yet"}.`
                  : remembered
                    ? remembered.do === "fact-forget"
                      ? "Done. I have forgotten that."
                      : "Done. I have corrected that."
                    : // Handing work over is always said, even from a silent reply.
                      handed.join(" "));
      if (said)
        await workAsync("message", {
          workAreaId: areaId,
          role: "firstmate",
          text: said,
          card: {
            kind: "request-reply",
            refs: Array.from(
              new Set([
                ...(ref ? [ref] : []),
                ...readRequestBlocks(turn.reply)
                  .reports.filter((report) => report.status === "delivered")
                  .map((report) => report.request),
              ]),
            ),
          },
          model: turn.model,
        });
      if (briefing) markBriefed();
      // Reports and documents: linked to a request only by its reference.
      if (/```amun/.test(turn.reply))
        await workAsync("apply-reply", {
          text: turn.reply,
          workAreaId: areaId,
          chatId: savedIn,
          saveText: false,
        });
      for (const followup of turn.followups)
        await workAsync("record-firstmate-reply", {
          text: followup,
          model: turn.model,
        });
      for (const proposed of parsed.actions) raise(proposed);
    } else if (turn.needsProvider) {
      // Kept, not failed: it goes out once a provider is connected.
      const message = {
        text,
        scoped,
        activityId: row,
        image,
        reason: "provider" as const,
        ref,
      };
      setBusy(false);
      inFlight.delete(threadKey);
      holdMessage(threadKey, message, true);
      return;
    } else {
      setProblem(turn.reason);
      // This turn failed for a reason other than a provider: it is not kept.
      // A message queued behind this failed turn is still sent.
    }
    setBusy(false);
    inFlight.delete(threadKey);
    if (heldMessage(threadKey)) retryWaiting();
    // The outcome is already on screen, so the Activity row closes quietly.
    if (row)
      work("activity", {
        activityId: row,
        groupId: null,
        workAreaId: areaId,
        text: label,
        state: turn.ok ? "finished" : "failed",
        silent: true,
      });
  };
  const attachments = useAttachments(areaId);
  const [pickNonce, setPickNonce] = useState(0);
  // Work that was started after the point a fork was taken from and is still
  // running: the owner is asked once whether Firstmate should stop it.
  const [settled, setSettled] = useState(() => readSettledStops());
  const settleStop = (fork: string, activity: string) => {
    const next = [...settled, `${fork}:${activity}`];
    setSettled(next);
    writeSettledStops(next);
  };
  // Only a fork has a fork point; a chat the owner started is a fresh topic.
  const fork = chat?.kind === "fork" ? chat : null;
  const forkedAt = fork ? forkPoint(fork) : null;
  const stopOffer =
    fork && forkedAt
      ? (snapshot.activity.find(
          (item) =>
            item.workAreaId === areaId &&
            item.state === "running" &&
            item.createdAt > forkedAt &&
            item.createdAt < fork.createdAt &&
            !settled.includes(`${fork.id}:${item.id}`),
        ) ?? null)
      : null;
  const send = async (typed: string) => {
    if ((!typed.trim() && !attachments.files.length) || !context) return;
    // A request for new work that belongs in a folder of its own is not sent
    // from here: Amun files it, or holds it and asks on Firstmate's card. A
    // message the owner already chose to keep here is sent as typed.
    const decided = attachments.files.length ? null : takeAsTyped(typed);
    if (!attachments.files.length && !decided) {
      const here = context.area;
      const loose = here.name === generalConversationName;
      const routed = routeNewWork({
        text: typed,
        today: localDay(Date.now()),
        areas: snapshot.areas.filter(
          (item) =>
            item.name !== generalConversationName &&
            (!here.groupId || !item.groupId || item.groupId === here.groupId),
        ),
        inside: loose ? null : { id: areaId, keptHere: here.keptHere },
      });
      if (routed.route === "create") {
        const made = await storeWorkAsync("create-area", {
          groupId: here.groupId,
          type: routed.request.type,
          name: routed.request.name,
          ...(routed.request.priority
            ? { priority: routed.request.priority }
            : {}),
          ...(routed.request.dueDate ? { dueAt: routed.request.dueDate } : {}),
        });
        if (made.ok && made.ref) {
          sendAsTyped(typed);
          return onWork(made.ref, null, typed.trim());
        }
      }
      if (routed.route === "existing" || routed.route === "offer_move") {
        const offer: MoveOffer = {
          kind: "move-offer",
          state: "open",
          held: typed.trim(),
          fromMessageId: null,
          request: routed.request,
          existingAreaId: routed.areaId,
          workAreaId: areaId,
          chatId: savedIn,
        };
        const existing = snapshot.areas.find(
          (item) => item.id === routed.areaId,
        );
        if (
          await askWhereItGoes(
            offer,
            moveQuestion(offer, here.name, existing?.name ?? null),
            here.groupId,
          )
        )
          return;
        // The question could not be saved: the message goes where it was typed.
      }
    }
    // A reminder is kept by Amun and answered here; it is not sent on to
    // Firstmate's model and creates no work.
    if (!attachments.files.length && reminderIntent(typed)) {
      const text = typed.trim();
      await workAsync("message", { workAreaId: areaId, role: "you", text });
      decided?.();
      const result = await workAsync("reminder", { text, workAreaId: areaId });
      await workAsync("message", {
        workAreaId: areaId,
        role: "firstmate",
        text: result.message,
      });
      return;
    }
    // Asking in words to retry a failed item runs the same governed retry as
    // the Retry button, under the same approval; Firstmate then reports it.
    const retry =
      !attachments.files.length && retryIntent(typed)
        ? retryTarget(snapshot.plans, areaId, typed)
        : null;
    if (retry && retry.kind !== "none") {
      await workAsync("message", {
        workAreaId: areaId,
        role: "you",
        text: typed.trim(),
      });
      decided?.();
      if (retry.kind === "retry")
        bridge.send({
          version: 1,
          kind: "plan-publish",
          planId: retry.planId,
          retry: true,
        });
      else
        await workAsync("message", {
          workAreaId: areaId,
          role: "firstmate",
          text:
            retry.kind === "review"
              ? "That plan changed after you approved it, so I cannot retry it. Please review and approve it again."
              : "More than one item failed. Use the Retry button on the one you mean.",
        });
      return;
    }
    // Files in the draft travel with this message.
    const picked = attachments.files;
    const readingFiles = attachments.take();
    const earlier = preparing.get(threadKey);
    let prepared!: () => void;
    const ready = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    preparing.set(threadKey, ready);
    let delivery: Promise<void> | undefined;
    try {
      await earlier;
      const text =
        typed.trim() ||
        `Attached ${picked.map((file) => file.name).join(", ")}`;
      lastRequest.current = text;
      // A chat started from a card carries the card with its first message.
      const asked = askCard;
      // Every request gets a stable reference; Firstmate repeats it in its
      // backlog links, hand-offs and replies (owner, 20 November 2026).
      const ref = newRequestRef();
      const files = await readingFiles;
      const attachedDocuments = files.flatMap((file) =>
        file.recordId ? [file.recordId] : [],
      );
      const saved = await workAsync("message", {
        workAreaId: areaId,
        role: "you",
        text,
        card: asked
          ? {
              kind: "ask-card",
              ref,
              label: asked.label,
              fields: asked.fields,
              documentIds: [
                ...new Set([
                  ...(
                    (asked.record as { documents?: { id: string }[] })
                      .documents ?? []
                  ).map((item) => item.id),
                  ...attachedDocuments,
                ]),
              ],
            }
          : { kind: "request", ref, documentIds: attachedDocuments },
      });
      if (saved.ok && saved.ref)
        await workAsync("register-request", {
          ref,
          messageId: saved.ref,
          // General has no project; a folder's work is the project until
          // Firstmate says otherwise.
          projectAreaId:
            context.area.name === generalConversationName ? null : areaId,
        });
      if (asked) setAsk(entryKey, null);
      // The owner's words are saved here now, so their question can be settled.
      decided?.();
      // A conversation that has not been told Amun's rules gets them with this
      // message: the first one for a work area, and the first after Firstmate's
      // conversation was started afresh.
      const briefing = !context.messages.length || needsBriefing();
      // A Firstmate whose memory has started fresh is given this chat's recap
      // with the message, without showing anything.
      const recap = needsBriefing() ? chatRecap(context.messages) : "";
      // Read before this message is added: what agents finished since the
      // owner last wrote goes to Firstmate with it.
      const news = agentNews(context.messages);
      const record = snapshot.rfps.find((item) => item.id === areaId);
      const [tracker, reasons] = await Promise.all([
        askTrackerTypes(areaId),
        askFailureReasons(
          snapshot.plans.filter((plan) => plan.workAreaId === areaId),
        ),
      ]);
      const header = areaTurnContext(
        context.area,
        typeLabels[context.area.type],
        context.group,
        record,
        openBlockers(snapshot.blockers, areaId).map(
          (item) => `${item.title} (${blockerLine(item, now)})`,
        ),
        factsFor(snapshot, context.area.groupId ?? null)
          .slice(0, 30)
          .map(factLine),
        standingPermissionLines(snapshot, context.area.groupId ?? null),
        [trackerLine(tracker), takeSprintContext(areaId)]
          .filter(Boolean)
          .join(" "),
        publicationLines(snapshot, areaId),
        context.objectives.map((item) => `${item.metric} (${item.line})`),
        snapshot.areas
          .filter(
            (item) =>
              item.groupId === context.area.groupId && item.id !== areaId,
          )
          .map((item) => item.name),
        notionPageLines(snapshot, areaId),
        failedPublicationLines(snapshot, areaId, reasons),
      );
      // In a fork, Firstmate is told which chat this is and what to set aside.
      // In a fork or a chat of its own, Firstmate is told which chat this is.
      const siblings = chatsOf(context.area, snapshot.chats, snapshot.messages);
      const which = !chat
        ? // The first chat is named too once the folder has others, so
          // "continue with that" is never read as another chat's.
          siblings.some((item) => item.chatId !== null && !item.empty)
          ? chatNote(
              context.area.firstChat.title ??
                text.replace(/\s+/g, " ").slice(0, 60),
              true,
              [],
            ) + "\n"
          : ""
        : chat.kind === "fork"
          ? forkNote(chat, context.messages) + "\n"
          : chatNote(
              chat.title || text.replace(/\s+/g, " ").slice(0, 60),
              context.messages.some((message) => message.role === "you"),
              siblings
                .filter((item) => item.chatId !== chat.id && !item.empty)
                .map((item) => item.title),
            ) + "\n";
      const about = asked
        ? `\n\nThe owner is asking about this record, as it was when they opened the chat:\n${JSON.stringify(asked.record)}`
        : "";
      const asks = [
        requestLine(ref),
        text,
        "",
        "Dispatch crew work through Firstmate’s native workflow as soon as the inputs are known. Reuse a completed session startup. If startup is required, complete it before arming the watcher. Keep the request reference first in the dispatch and in the crew’s completion report. Acknowledge dispatch briefly and end the turn.",
        `For a read-only PRD review with an exact source and an existing available PRD second mate, send one brief using fm-send.sh prd and let that command enforce its native lease and delivery checks. Follow any lease refusal. Ask PRD to load the document once in full (one Read call if it fits, multiple only when required) and send a concise, captain-ready plain-text answer. If you authorize Amun to forward that exact answer when it arrives, start your dispatch with the literal prefix "${ref} amun-relay=read-only ". Only set this marker for read-only reports, never for approvals or writes.`,
        "When reporting a result, include the tracked fenced amun status, with delivered for a completed answer even if there is no document.",
      ].join("\n");
      const scoped = briefing
        ? `${amunProtocol}\n${requestProtocol}\n\n${header}${which}${recap}${asks}${about}`
        : `${header}${which}${asks}${about}`;
      const withFiles = files.length
        ? `${scoped}\n\n${attachmentBlock(files)}`
        : scoped;
      // Saved documents travel after the owner's words, labelled as reference.
      const fresh = latest.current;
      const documents = documentContext({
        snapshot: {
          ...fresh.snapshot,
          library: fresh.snapshot.library.filter(
            (item) => !files.some((file) => file.recordId === item.id),
          ),
        },
        limit: 32000,
        areaId,
        request: text,
        openId: fresh.pane?.kind === "output" ? fresh.pane.id : null,
        used: news.length + withFiles.length,
      });
      delivery = deliver(
        text,
        news + (documents ? `${withFiles}\n\n${documents}` : withFiles),
        null,
        files.find((file) => file.image)?.image ?? undefined,
        false,
        briefing,
        ref,
      );
    } finally {
      prepared();
      if (preparing.get(threadKey) === ready) preparing.delete(threadKey);
    }
    await delivery;
  };
  /** Tries the waiting message again. It leaves the wait before it is sent. */
  const retryWaiting = () => {
    // One attempt at a time per work area, so it can only go out once. It
    // stays saved and on screen as waiting until Firstmate has answered.
    const message = heldMessage(threadKey);
    if (!message || inFlight.has(threadKey)) return;
    void deliver(
      message.text,
      message.scoped,
      message.activityId ?? null,
      message.image,
      true,
      message.scoped.includes(amunProtocol),
      message.ref,
    );
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  // send() awaits before reading the Library; a save landing meanwhile must
  // not be missed, or a document just typed reaches Firstmate as empty.
  const latest = useRef({ snapshot, pane });
  latest.current = { snapshot, pane };
  useEffect(() => {
    // Offers the owner accepted: each becomes a real request to Firstmate
    // here, once. One a restart cut short is said so, and not sent again.
    // Claiming again on every new acceptance sends an offer for the work that
    // is already open straight away; claimed turns are never claimed twice.
    if (!context) return;
    const claim = () => {
      const { send: queued, interrupted } = pendingOffers.claim(areaId);
      if (interrupted.length)
        work("message", {
          workAreaId: areaId,
          role: "firstmate",
          text: "Amun closed while I was starting the draft you asked for, so I cannot tell whether it finished. Read the conversation above before asking again.",
        });
      for (const turn of queued)
        void sendRef
          .current(turn.text)
          .finally(() => pendingOffers.done(turn.id));
    };
    claim();
    return pendingOffers.subscribe(claim);
  }, [areaId, !!context]);
  useEffect(() => {
    // Returning to this conversation: one attempt for a message left waiting.
    if (heldMessage(threadKey)) retryWaiting();
  }, [threadKey]);
  useEffect(() => {
    if (!waiting) return;
    // Coming back from sign-in, or a change in the connected providers.
    let providers = JSON.stringify(bridge.getSnapshot().modelStatus);
    const stop = bridge.subscribe(() => {
      const next = JSON.stringify(bridge.getSnapshot().modelStatus);
      if (next === providers) return;
      providers = next;
      retryWaiting();
    });
    window.addEventListener("focus", retryWaiting);
    return () => {
      stop();
      window.removeEventListener("focus", retryWaiting);
    };
  }, [threadKey, !!waiting]);
  useEffect(() => {
    if (first && context && sentFirst.current !== first) {
      sentFirst.current = first;
      void send(first);
    }
  }, [first, areaId, !!context]);
  const memory = useChatMemory();
  const askCard = memory.asks[entryKey] ?? null;
  const isGeneral = context?.area.name === generalConversationName;
  // Unsent words: a chat's own, or, before its first message, the folder's
  // draft behind its +, Home's shared draft in General, or a card question's.
  const draftKey = askCard
    ? askDraftKey(entryKey)
    : !context?.messages.length
      ? isGeneral
        ? homeDraftKey
        : folderDraftKey(areaId)
      : chatDraftKey(entryKey);
  /** The owner's message that a request reference belongs to, if confirmed. */
  const requestMessage = (ref: string | null | undefined) =>
    ref
      ? (context?.messages.find(
          (message) =>
            message.role === "you" && requestRefOf(message.card) === ref,
        ) ?? null)
      : null;
  /** Where the request this message carries stands, from Firstmate's reports. */
  const requestLineFor = (card: unknown) => {
    const ref = requestRefOf(card);
    const request = ref
      ? snapshot.requests.find((item) => item.ref === ref)
      : undefined;
    if (ref && queue.some((item) => item.ref === ref))
      return <span className="tag warn">Queued</span>;
    if (!request || request.status === "sent") return null;
    const deliveries = (context?.messages ?? []).flatMap((message) => {
      const delivered = deliveredOf(message.card);
      return delivered?.request === ref
        ? [
            {
              messageId: message.id,
              title: delivered.title,
              version: delivered.version,
            },
          ]
        : [];
    });
    const name = (id: string | null) =>
      id ? (snapshot.areas.find((area) => area.id === id)?.name ?? null) : null;
    return (
      <RequestLine
        request={request}
        deliveries={deliveries}
        replyId={
          context?.messages.findLast((message) => {
            const card = message.card as {
              kind?: string;
              refs?: unknown;
            } | null;
            return (
              message.role === "firstmate" &&
              card?.kind === "request-reply" &&
              Array.isArray(card.refs) &&
              card.refs.includes(ref)
            );
          })?.id ?? null
        }
        line={requestStatusLine(
          request,
          new Set(deliveries.map((item) => item.title)).size,
          request.parts,
        )}
        project={name(request.projectAreaId)}
        changeTo={name(request.changeToAreaId)}
        onShow={(id) => reading.show(id)}
      />
    );
  };
  const reading = useReading({
    chatKey: entryKey,
    messages: context?.messages ?? noMessages,
    thread,
    focus,
  });
  // While waiting for Firstmate, the owner's own message stays in view.
  useEffect(() => {
    if (busy && thread.current && reading.following())
      thread.current.scrollTop = thread.current.scrollHeight;
  }, [busy]);
  useEffect(() => {
    work("touch-area", { areaId });
  }, [areaId]);
  if (!context)
    return (
      <div className="rb-scroll">
        <p className="rb-empty">That work is no longer here.</p>
      </div>
    );
  const { area } = context;
  const reviewContext =
    workspace?.productContext?.productId === area.productId
      ? workspace.productContext
      : null;
  const chatReviews =
    reviewContext?.storyReviews?.filter(
      (r) =>
        r.areaId === areaId &&
        r.chatId === chatId &&
        reviewContext.objectives.some(
          (o) => o.id === r.objectiveId && o.prd?.version === r.version,
        ),
    ) ?? [];
  const lastReplyId = context.messages[latestTurnStart(context.messages)]?.id;
  const open = pane !== null;
  // Only this work's own questions. The First Mate's standing holds (often a
  // dozen) used to be listed in every chat, below the messages, which pushed
  // what the owner had just sent out of sight. They are answered from Needs
  // your attention and from the Firstmate card, which is on every screen.
  const questions = snapshot.attention.filter(
    (item) =>
      item.kind === "question" &&
      item.state === "open" &&
      item.workAreaId === areaId &&
      // "Where should this go?" is asked on Firstmate's card.
      !isMoveQuestion(item),
  );
  // Firstmate hands work to its crew; name who is working while it is busy.
  const crewAtWork = snapshot.agents
    .filter((agent) => agent.kind !== "lead" && agent.state === "working")
    .map((agent) => agent.role)
    .slice(0, 6);
  const lastMessage = context.messages.at(-1);
  const lastAsk =
    lastMessage?.role === "firstmate" &&
    questions.length === 0 &&
    !closedAsks.includes(lastMessage.id)
      ? lastMessage
      : null;
  const askAzure =
    lastAsk !== null && !azureConnected && mentionsAzureDevOps(lastAsk.text);
  const asked = lastAsk && !askAzure ? parseQuestion(lastAsk.text) : null;
  const closeAsk = () =>
    lastAsk && setClosedAsks((ids) => [...ids, lastAsk.id]);
  const plans = snapshot.plans.filter(
    (plan) => plan.workAreaId === areaId && plan.state === "proposed",
  );
  const running = snapshot.activity.filter(
    (item) => item.workAreaId === areaId && item.state === "running",
  );
  const steps = snapshot.activity
    .filter((item) => item.workAreaId === areaId)
    .slice(0, 12);
  const output =
    pane?.kind === "output"
      ? snapshot.library.find((item) => item.id === pane.id)
      : null;
  const drag = (clientX: number) => {
    const box = grid.current?.getBoundingClientRect();
    if (!box) return;
    onResize(1 - (clientX - box.left) / box.width);
  };
  const paneTitle =
    pane?.kind === "plan"
      ? "Review"
      : pane?.kind === "browser"
        ? "Browser"
        : pane?.kind === "prd"
          ? "PRD"
          : pane?.kind === "backlog"
            ? "Backlog"
            : pane?.kind === "pulls"
              ? "Pull requests"
              : pane?.kind === "happened"
                ? "What happened"
                : (output?.title ?? "");
  const newOutput = async () => {
    const result = await workAsync("save-output", {
      groupId: area.groupId,
      type: "doc",
      title: "Untitled",
      workAreaIds: [areaId],
    });
    if (result.ref) onPane({ kind: "output", id: result.ref });
  };
  return (
    <div
      ref={grid}
      className={
        "rb-session" +
        (open ? " split" : "") +
        (open && expanded ? " full" : "")
      }
      style={{ ["--ratio" as string]: ratio }}
      onPointerMove={(event) => dragging && drag(event.clientX)}
      onPointerUp={() => setDragging(false)}
    >
      <section className="rb-convo" aria-label="Conversation">
        <div className="rb-crumb">
          <span>{context.group ?? "No group yet"}</span>
          <Icon name="chevron" width={12} height={12} />
          <span className="name" style={{ position: "relative" }}>
            {areaName !== null && (
              <form
                style={{ display: "inline" }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = areaName.trim();
                  if (next && next !== area.name)
                    work("update-area", { areaId, patch: { name: next } });
                  setAreaName(null);
                }}
              >
                <input
                  type="text"
                  aria-label="Name of this work"
                  autoFocus
                  maxLength={120}
                  value={areaName}
                  onChange={(event) => setAreaName(event.target.value)}
                  onBlur={() => setAreaName(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setAreaName(null);
                  }}
                />
              </form>
            )}
            <button
              className="here"
              hidden={areaName !== null}
              aria-expanded={menu === "area"}
              onClick={() => {
                setConfirmDelete(false);
                setMenu(menu === "area" ? null : "area");
              }}
            >
              {area.name}
              <Icon
                name="chevron"
                width={12}
                height={12}
                style={{ rotate: "90deg" }}
              />
            </button>
            {menu === "area" && (
              <div
                className="rb-menu"
                role="menu"
                style={{ top: "calc(100% + 4px)", left: 0 }}
              >
                {confirmDelete ? (
                  <>
                    <div className="rb-menu-title">
                      Delete “{area.name}”? Its chat, plans and anything waiting
                      on it go with it.
                    </div>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        setConfirmDelete(false);
                        work("delete-area", { areaId });
                      }}
                    >
                      Delete it
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        setAreaName(area.name);
                      }}
                    >
                      Rename
                    </button>
                    {area.type === "project" && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenu(null);
                          setClientDraft(area.client ?? "");
                        }}
                      >
                        {area.client ? "Change client" : "Set client"}
                      </button>
                    )}
                    <button
                      role="menuitem"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete…
                    </button>
                  </>
                )}
                <div className="rb-menu-title">Filed under</div>
                {snapshot.groups.map((group) => (
                  <button
                    key={group.id}
                    role="menuitemradio"
                    aria-checked={group.id === area.groupId}
                    onClick={() => {
                      setMenu(null);
                      work("update-area", {
                        areaId,
                        patch: { groupId: group.id },
                      });
                    }}
                  >
                    {group.name}
                    {group.id === area.groupId && (
                      <span className="hint">Current</span>
                    )}
                  </button>
                ))}
                {!snapshot.groups.length && (
                  <button role="menuitem" onClick={onGroupNeeded}>
                    Add a group…
                  </button>
                )}
              </div>
            )}
          </span>
          <span className="tag">{typeLabels[area.type]}</span>
          {area.type === "project" && clientDraft !== null && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const next = clientDraft.trim();
                if (next !== (area.client ?? ""))
                  work("update-area", {
                    areaId,
                    patch: { client: next || null },
                  });
                setClientDraft(null);
              }}
            >
              <input
                type="text"
                aria-label="Client for this project"
                placeholder="Client name"
                autoFocus
                maxLength={200}
                value={clientDraft}
                onChange={(event) => setClientDraft(event.target.value)}
                onBlur={() => setClientDraft(null)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setClientDraft(null);
                }}
              />
            </form>
          )}
          {area.type === "project" && area.client && clientDraft === null && (
            <span className="tag">Client: {area.client}</span>
          )}
          {area.convertedFrom && <span className="tag">Was a task</span>}
          <span className="grow" />
          {area.productId && !open && (
            <>
              <button
                className="btn quiet"
                onClick={() => {
                  inspectView({
                    view: "PRD",
                    areaId,
                    project: area.name,
                    source: "Project",
                  });
                  onPane({ kind: "prd" });
                }}
              >
                PRD
              </button>
              <button
                className="btn quiet"
                onClick={() => {
                  inspectView({
                    view: "Backlog",
                    areaId,
                    project: area.name,
                    source: "Project",
                  });
                  onPane({ kind: "backlog" });
                }}
              >
                Backlog
              </button>
              <button
                className="btn quiet"
                onClick={() => {
                  inspectView({
                    view: "Pull requests",
                    areaId,
                    project: area.name,
                    source: "Project",
                  });
                  onPane({ kind: "pulls" });
                }}
              >
                Pull requests
              </button>
            </>
          )}
          {!open && (
            <button
              className="btn quiet"
              onClick={() =>
                onPane({ kind: "browser", url: "https://www.google.com" })
              }
            >
              Browser
            </button>
          )}
          {!open && (
            <button
              className="btn quiet"
              onClick={() => {
                inspectView({
                  view: "What happened",
                  areaId,
                  project: area.name,
                  source: "Project",
                });
                onPane({ kind: "happened" });
              }}
            >
              What happened
            </button>
          )}
          {!open && (
            <button className="btn quiet" onClick={newOutput}>
              <Icon name="plus" width={15} height={15} />
              New document
            </button>
          )}
        </div>
        {context.failure && (
          <div className="rb-banner" role="alert">
            <Icon name="warning" />
            <div className="text">
              <strong>{context.failure.title}</strong>
              <div className="small">{context.failure.detail}</div>
            </div>
            {context.failure.options[0] && (
              <button
                className="btn"
                onClick={() => {
                  const planId = context.failure!.ref?.startsWith("failure:")
                    ? context.failure!.ref.slice(8)
                    : null;
                  const plan = snapshot.plans.find(
                    (item) => item.id === planId,
                  );
                  if (!planId || !plan) {
                    // Not tied to a plan Amun can continue: ask Firstmate.
                    void send(
                      `${context.failure!.options[0]}: check what already exists first, then continue.`,
                    );
                  } else if (
                    !["approved", "partial", "failed"].includes(plan.state)
                  ) {
                    // Changed since approval: the owner reviews it again.
                    onPane({ kind: "plan", id: planId });
                  } else
                    bridge.send({
                      version: 1,
                      kind: "plan-publish",
                      planId,
                      ...(context.failure!.options[0]!.startsWith("Retry")
                        ? { retry: true }
                        : {}),
                    });
                }}
              >
                {context.failure.options[0]}
              </button>
            )}
            <button
              className="icon-btn"
              aria-label="More about this failure"
              aria-expanded={menu === "fail"}
              onClick={() => setMenu(menu === "fail" ? null : "fail")}
            >
              <Icon name="more" width={18} height={18} />
            </button>
            {menu === "fail" && (
              <div
                className="rb-menu"
                role="menu"
                style={{ right: 8, top: "calc(100% + 4px)" }}
              >
                {failurePlan && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      onPane({ kind: "plan", id: failurePlan });
                    }}
                  >
                    {failureOverflow[0]}
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={async () => {
                    const copied = await copyText(
                      [
                        `Amun failure in "${area.name}"`,
                        context.failure!.title,
                        context.failure!.detail,
                        ...steps.map(
                          (step) =>
                            `${step.createdAt} ${step.state} ${step.text}`,
                        ),
                      ].join("\n"),
                    );
                    // Stay open long enough to say whether it worked.
                    setCopiedLog(copied ? "Copied" : "Could not copy");
                    setTimeout(() => {
                      setCopiedLog("");
                      setMenu(null);
                    }, 1200);
                  }}
                >
                  {copiedLog || failureOverflow[1]}
                </button>
              </div>
            )}
          </div>
        )}
        {(onBackToResults || reading.missing) && (
          <div className="rb-reading-bar">
            {onBackToResults && (
              <button className="link" onClick={onBackToResults}>
                ← Back to results
              </button>
            )}
            {reading.missing && (
              <span className="muted small" role="status">
                That passage could not be found in this chat any more.
              </span>
            )}
          </div>
        )}
        <div className="rb-thread" ref={thread}>
          <div className="inner">
            <div className="msgs">
              {fork && (
                <p className="muted small">
                  Forked from{" "}
                  {fork.fromChatId ? "another chat" : "the first chat"}.{" "}
                  <button
                    className="link"
                    onClick={() => onChat(fork.fromChatId)}
                  >
                    Back to that chat
                  </button>
                </p>
              )}
              {!context.messages.length && !busy && (
                <p className="muted">
                  {area.purpose ||
                    (area.type === "rfp"
                      ? rfpAuthoringBoundary
                      : `Tell Firstmate what you want done for ${area.name}.`)}
                </p>
              )}
              {openBlockers(snapshot.blockers, areaId).map((item) => (
                <BlockerRow
                  key={item.id}
                  blocker={item}
                  projectName={area.name}
                  now={now}
                />
              ))}
              {context.objectives.map((objective) => (
                <div
                  className="rb-inline"
                  aria-label="Objective"
                  key={objective.id}
                >
                  <div className="row">
                    <strong className="grow">{objective.metric}</strong>
                    <span
                      className={
                        "tag " +
                        (objective.progress.state === "reached"
                          ? "good"
                          : objective.progress.state === "conflict"
                            ? "warn"
                            : "")
                      }
                    >
                      Objective
                    </span>
                  </div>
                  <span className="muted small">{objective.line}</span>
                  {"ratio" in objective.progress && (
                    <div className="rb-capacity" aria-hidden="true">
                      <i
                        style={{
                          width: `${(objective.progress.ratio ?? 0) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              {context.rfp && (
                <div className="rb-inline" aria-label="RFP status">
                  <div className="row wrap">
                    <strong className="grow">
                      {context.rfp.client || "Client not set"}
                    </strong>
                    {context.rfp.card.countdown && (
                      <span
                        className={
                          "tag " + (context.rfp.card.atRisk ? "bad" : "")
                        }
                      >
                        {context.rfp.card.countdown}
                      </span>
                    )}
                    {context.rfp.card.missingOwner && (
                      <span className="tag warn">No response owner</span>
                    )}
                  </div>
                  {context.rfp.card.subline && (
                    <span className="note">{context.rfp.card.subline}</span>
                  )}
                  <span className="note">{rfpAuthoringBoundary}</span>
                </div>
              )}
              {context.messages.map((message, position) =>
                deliveredOf(message.card) ? (
                  <div
                    key={message.id}
                    data-mid={message.id}
                    className={reading.flash === message.id ? "flash" : ""}
                  >
                    <DeliveredReply
                      named={
                        context.messages[position - 1]?.role !== "firstmate"
                      }
                      card={deliveredOf(message.card)!}
                      available={snapshot.library.some(
                        (item) =>
                          item.id === deliveredOf(message.card)!.outputId,
                      )}
                      request={
                        requestMessage(deliveredOf(message.card)!.request)
                          ?.text ?? null
                      }
                      onOpen={() => {
                        const card = deliveredOf(message.card)!;
                        onPane({
                          kind: "output",
                          id: card.outputId,
                          version: card.version,
                        });
                      }}
                      onRequest={() => {
                        const asked = requestMessage(
                          deliveredOf(message.card)!.request,
                        );
                        if (asked) reading.show(asked.id);
                      }}
                    />
                  </div>
                ) : asMoveOffer(message.card) || asMovedLine(message.card) ? (
                  <MoveLine
                    key={message.id}
                    card={message.card}
                    onOpen={(to, chatId) => onWork(to, chatId)}
                  />
                ) : message.role === "card" ? (
                  message.id === lastReplyId ? (
                    <div
                      key={message.id}
                      data-mid={message.id}
                      ref={latestReply}
                    >
                      <InlineCard
                        snapshot={snapshot}
                        areaId={areaId}
                        card={
                          (message.card ?? {
                            kind: "note",
                            text: message.text,
                          }) as Card
                        }
                      />
                    </div>
                  ) : (
                    <div data-mid={message.id} key={message.id}>
                      <InlineCard
                        snapshot={snapshot}
                        areaId={areaId}
                        card={
                          (message.card ?? {
                            kind: "note",
                            text: message.text,
                          }) as Card
                        }
                      />
                    </div>
                  )
                ) : (
                  <Fragment key={message.id}>
                    {message.id === reading.divider && (
                      <div className="rb-new-replies" role="separator">
                        New replies
                      </div>
                    )}
                    <div
                      className={
                        "rb-turn " +
                        message.role +
                        (reading.flash === message.id ? " flash" : "")
                      }
                      data-mid={message.id}
                      data-unread={
                        message.role === "firstmate" && message.readAt === null
                          ? "true"
                          : undefined
                      }
                    >
                      <div
                        ref={
                          message.id === lastReplyId ? latestReply : undefined
                        }
                        className={"rb-msg " + message.role}
                      >
                        {/* Firstmate is named where its turn begins, on the left;
                        the owner's own messages sit on the right. */}
                        {message.role === "firstmate" &&
                          context.messages[position - 1]?.role !==
                            "firstmate" && (
                            <span className="who">
                              <FirstmateMark size={18} />
                              Firstmate
                              {modelDisplay(message.model ?? null) && (
                                <span className="muted small">
                                  {"· "}
                                  {modelDisplay(message.model ?? null)}
                                </span>
                              )}
                            </span>
                          )}
                        {message.role === "firstmate" ? (
                          <MarkdownMessage
                            text={message.text}
                            onLink={(url) => onPane({ kind: "browser", url })}
                            citations={citations}
                          />
                        ) : (
                          <>
                            {message.text}
                            {askCardOf(message.card) && (
                              <AskAttachment
                                card={askCardOf(message.card)!}
                                sent
                              />
                            )}
                          </>
                        )}
                      </div>
                      <MessageActions
                        text={message.text}
                        onFork={async () => {
                          const made = await storeWorkAsync("fork-chat", {
                            workAreaId: areaId,
                            messageId: message.id,
                          });
                          if (made.ref) onChat(made.ref);
                        }}
                      />
                      {message.role === "you" && requestLineFor(message.card)}
                    </div>
                    {reviewContext &&
                      chatReviews
                        .filter((r) => r.messageId === message.id)
                        .map((r) => (
                          <details
                            key={r.ref}
                            className="rb-inline"
                            onToggle={(e) => {
                              if (e.currentTarget.open)
                                inspectView({
                                  view: "Story proposals",
                                  areaId,
                                  record: r.ref,
                                  source: "Chat",
                                });
                            }}
                          >
                            <summary>
                              Review story proposals · PRD v{r.version}
                            </summary>
                            <ReviewOrigin.Provider value={{ areaId, chatId }}>
                              <StoryProposals
                                context={reviewContext}
                                objectiveId={r.objectiveId}
                                version={r.version}
                              />
                            </ReviewOrigin.Provider>
                            <button
                              className="btn quiet"
                              onClick={() => {
                                inspectView({
                                  view: "Full PRD review",
                                  areaId,
                                  record: r.ref,
                                  source: "Chat",
                                });
                                onPane({
                                  kind: "prd",
                                  objectiveId: r.objectiveId,
                                });
                              }}
                            >
                              Open full review
                            </button>
                          </details>
                        ))}
                  </Fragment>
                ),
              )}
              {fork && stopOffer && (
                <div
                  className="rb-inline amber"
                  role="group"
                  aria-label="Work still running"
                >
                  <span>
                    “{stopOffer.text}” is still running. It was started after
                    the point you forked from. Stop it?
                  </span>
                  <span className="note">
                    Stopping is a request to Firstmate. Leaving it running
                    changes nothing.
                  </span>
                  <div className="row wrap">
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        settleStop(fork.id, stopOffer.id);
                        void send(
                          `Please stop this work: “${stopOffer.text}”. I am trying a different direction in this chat.`,
                        );
                      }}
                    >
                      Stop it
                    </button>
                    <button
                      className="btn quiet"
                      onClick={() => settleStop(fork.id, stopOffer.id)}
                    >
                      Leave it running
                    </button>
                  </div>
                </div>
              )}
              {waiting && (!waiting.ref || waiting.reason !== "busy") && (
                <>
                  <span
                    className="tag warn"
                    style={{ justifySelf: "end" }}
                    role="status"
                  >
                    Waiting to send
                  </span>
                  {waitParts(waitReason(waiting)).providerAlert && (
                    <div className="rb-inline amber" role="alert">
                      <span>
                        <strong style={{ fontWeight: 600 }}>
                          Connect an AI provider to send this.
                        </strong>{" "}
                        Your message is saved and goes out once, as soon as a
                        provider is connected.
                      </span>
                      <div className="row">
                        <button className="btn primary" onClick={onSettings}>
                          Connect a provider
                        </button>
                        <button
                          className="btn quiet"
                          onClick={() => {
                            releaseMessage(threadKey);
                          }}
                        >
                          Discard message
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {steps.length > 0 && (
                <>
                  <button
                    className="rb-activity-line"
                    aria-expanded={showSteps}
                    onClick={() => setShowSteps(!showSteps)}
                  >
                    {running.length
                      ? `Working on ${running.length} ${running.length === 1 ? "thing" : "things"}`
                      : `${steps.length} recent ${steps.length === 1 ? "step" : "steps"}`}
                    <Icon
                      name="chevron"
                      width={12}
                      height={12}
                      style={{ rotate: showSteps ? "90deg" : "0deg" }}
                    />
                  </button>
                  {showSteps && (
                    <div className="rb-inline">
                      {steps.map((step) => (
                        <span key={step.id} className="small">
                          <span
                            className={
                              "rb-live " +
                              (step.state === "running" ? "working" : "")
                            }
                            style={{ display: "inline-block", marginRight: 8 }}
                          />
                          {step.text}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
              {plans.map((plan) => (
                <div className="rb-inline" key={plan.id}>
                  <strong>{plan.summary}</strong>
                  <span className="note">
                    {previewNote(plan.destination, planDestinations(plan))}
                  </span>
                  <button
                    className="btn"
                    style={{ justifySelf: "start" }}
                    onClick={() => onPane({ kind: "plan", id: plan.id })}
                  >
                    Review changes
                  </button>
                </div>
              ))}
              {context.outputs
                .filter((item) => item.section === "output")
                .slice(0, 4)
                .map((item) => (
                  <button
                    key={item.id}
                    className="rb-inline"
                    style={{ textAlign: "left", justifyContent: "stretch" }}
                    aria-pressed={
                      pane?.kind === "output" && pane.id === item.id
                    }
                    onClick={() => onPane({ kind: "output", id: item.id })}
                  >
                    <span className="row">
                      <Icon name="prd" width={18} height={18} />
                      <strong className="grow">{item.title}</strong>
                      <span className="tag">
                        {approvalLabel(approvalOf(item)) || item.status}
                      </span>
                    </span>
                    <span className="note">
                      {typeName(item.type)} · opens beside the conversation
                    </span>
                  </button>
                ))}
              {questions.map((question) => {
                const parsed =
                  question.options.length > 0
                    ? null
                    : parseQuestion(
                        question.title + "\n" + (question.detail ?? ""),
                      );
                return (
                  <QuestionCard
                    key={question.id}
                    title={parsed?.question ?? question.title}
                    detail={parsed ? null : question.detail}
                    options={parsed?.options ?? question.options}
                    recommended={parsed?.recommended ?? null}
                    why={parsed?.why ?? null}
                    onAnswer={(text) => answerQuestion(question, text)}
                    onDismiss={() =>
                      work("resolve-attention", {
                        attentionId: question.id,
                        resolution: "done",
                      })
                    }
                  />
                );
              })}
              {askAzure && (
                <AzureConnectCard
                  product={area.name}
                  onDismiss={closeAsk}
                  onAnswer={(text) => {
                    closeAsk();
                    void send(text);
                  }}
                />
              )}
              {asked && (
                <QuestionCard
                  title={asked.question}
                  options={asked.options}
                  recommended={asked.recommended}
                  why={asked.why}
                  onAnswer={(text) => {
                    closeAsk();
                    void send(text);
                  }}
                  onDismiss={closeAsk}
                />
              )}
              {context.conversion && (
                <div
                  className="rb-inline"
                  role="group"
                  aria-label="Make this a project"
                >
                  <span>{context.conversion.text}</span>
                  <div className="row">
                    <button
                      className="btn"
                      onClick={() =>
                        work("convert-task", { areaId, convert: true })
                      }
                    >
                      Convert
                    </button>
                    <button
                      className="btn quiet"
                      onClick={() =>
                        work("convert-task", { areaId, convert: false })
                      }
                    >
                      Keep as task
                    </button>
                  </div>
                  <span className="note">
                    Keeps its history, links, objective and tracker.
                  </span>
                </div>
              )}
              {snapshot.ruleCandidate &&
                snapshot.ruleCandidate.groupId === area.groupId && (
                  <div
                    className="rb-inline"
                    role="group"
                    aria-label="Remember this"
                  >
                    <span>{snapshot.ruleCandidate.ask}</span>
                    <span className="note">
                      Applies to {context.group ?? "this group"} only, in this
                      situation.
                    </span>
                    <div className="row wrap">
                      {(
                        [
                          ["remember", "Yes, remember"],
                          ["not_now", "Not now"],
                          ["never", "Never ask"],
                        ] as const
                      ).map(([choice, label]) => (
                        <button
                          key={choice}
                          className={
                            "btn" + (choice === "remember" ? "" : " quiet")
                          }
                          onClick={() =>
                            work("decide-rule", {
                              groupId: snapshot.ruleCandidate!.groupId,
                              situation: snapshot.ruleCandidate!.situation,
                              resolution: snapshot.ruleCandidate!.resolution,
                              choice,
                            })
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              {busy && (
                <p className="muted rb-working" role="status">
                  <FirstmateMark size={22} mood="working" />
                  Firstmate is working…
                  {crewAtWork.length > 0 && (
                    <span className="small">
                      {" "}
                      Crew at work: {crewAtWork.join(", ")}.
                    </span>
                  )}
                </p>
              )}
              {attachments.problem && (
                <div className="rb-inline amber" role="status">
                  {attachments.problem.read === "part" ? (
                    <span>
                      I could only read the first part of{" "}
                      <strong style={{ fontWeight: 600 }}>
                        {attachments.problem.name}
                      </strong>
                      , {portionWords(attachments.problem.portion)} of it. Tell
                      me which part matters and I’ll read that.
                    </span>
                  ) : (
                    <span>
                      I couldn’t open{" "}
                      <strong style={{ fontWeight: 600 }}>
                        {attachments.problem.name}
                      </strong>
                      . It’s saved in your library. A PDF or text version will
                      work.
                    </span>
                  )}
                  <div className="row">
                    {attachments.problem.read === "part" ? (
                      <button
                        className="btn"
                        onClick={() =>
                          attachments.settle(attachments.problem!.id)
                        }
                      >
                        Use what was read
                      </button>
                    ) : (
                      <button
                        className="btn"
                        onClick={() => {
                          attachments.remove(attachments.problem!.name);
                          setPickNonce((value) => value + 1);
                        }}
                      >
                        Choose another file
                      </button>
                    )}
                    <button
                      className="btn quiet"
                      onClick={() =>
                        attachments.remove(attachments.problem!.name)
                      }
                    >
                      Remove the file
                    </button>
                  </div>
                </div>
              )}
              {problem && (
                <div className="rb-inline amber" role="alert">
                  <span>{problem}</span>
                  <button
                    className="btn"
                    style={{ justifySelf: "start" }}
                    onClick={onSettings}
                  >
                    Open Accounts and models
                  </button>
                </div>
              )}
              {reading.newBelow && (
                <button className="rb-new-below" onClick={reading.jumpDown}>
                  New reply ↓
                </button>
              )}
              <div ref={end} />
            </div>
          </div>
        </div>
        <Composer
          key={(seed?.nonce ?? "composer") + draftKey}
          initial={seed?.text ?? ""}
          draftKey={draftKey}
          above={askCard ? <AskAttachment card={askCard} /> : null}
          autoFocus
          skills
          onBoard={(url) => onPane({ kind: "browser", url })}
          model={model}
          placeholder={
            area.type === "rfp"
              ? "Ask Firstmate about this RFP…"
              : `Ask Firstmate about ${area.name}…`
          }
          agents={snapshot.agents
            .filter((agent) => agent.enabled)
            .map((agent) => ({ id: agent.id, name: agent.role }))}
          workAreas={snapshot.areas.map((item) => ({
            id: item.id,
            name: item.name,
          }))}
          attached={attachments.files.map((file) => file.name)}
          onPick={attachments.add}
          onRemoveFile={attachments.remove}
          pickNonce={pickNonce}
          onPlus={(item) => {
            if (item === "screenshot") attachments.screenshot();
          }}
          onSend={(text) => {
            const question = questions[0];
            if (question && seed)
              work("resolve-attention", {
                attentionId: question.id,
                resolution: "answer",
                answer: text,
                // The answer is sent to Firstmate as the next message.
                told: true,
              });
            setSeed(null);
            void send(text);
          }}
        />
      </section>
      {open && (
        <>
          <div
            className={"rb-divider" + (dragging ? " dragging" : "")}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the document"
            aria-valuemin={Math.round(minRatio * 100)}
            aria-valuemax={Math.round(maxRatio * 100)}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
            }}
            onPointerMove={(event) => dragging && drag(event.clientX)}
            onPointerUp={() => setDragging(false)}
            onDoubleClick={() => onResize(0.5)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") onResize(ratio + 0.04);
              if (event.key === "ArrowRight") onResize(ratio - 0.04);
            }}
          />
          <section className="rb-artifact" aria-label={paneTitle || "Document"}>
            <header ref={titleRoot}>
              {renaming && output ? (
                <form
                  className="grow"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = new FormData(event.currentTarget).get("name");
                    if (typeof name === "string" && name.trim())
                      work("save-output", {
                        outputId: output.id,
                        groupId: output.groupId,
                        type: output.type,
                        title: name.trim(),
                        body: output.body,
                        status: output.status,
                        workAreaIds: output.workAreaIds,
                      });
                    setRenaming(false);
                  }}
                >
                  <input
                    name="name"
                    type="text"
                    aria-label="Document name"
                    autoFocus
                    defaultValue={output.title}
                    maxLength={200}
                    onBlur={() => setRenaming(false)}
                    style={{ width: "100%" }}
                  />
                </form>
              ) : (
                <button
                  className="here"
                  style={{ fontWeight: 600, padding: "4px 8px" }}
                  aria-expanded={menu === "title"}
                  disabled={!output || output.section === "record"}
                  onClick={() => setMenu(menu === "title" ? null : "title")}
                >
                  {paneTitle}
                  {output && output.section === "output" && (
                    <Icon
                      name="chevron"
                      width={12}
                      height={12}
                      style={{ rotate: "90deg" }}
                    />
                  )}
                </button>
              )}
              {menu === "title" && output && (
                <div
                  className="rb-menu"
                  role="menu"
                  style={{ top: "calc(100% - 6px)", left: 16 }}
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    role="menuitem"
                    onClick={async () => {
                      setMenu(null);
                      const copy = await workAsync("save-output", {
                        groupId: output.groupId,
                        type: output.type,
                        title: output.title + " copy",
                        body: output.body,
                        workAreaIds: output.workAreaIds,
                      });
                      if (copy.ref) onPane({ kind: "output", id: copy.ref });
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      const link = document.createElement("a");
                      link.href = URL.createObjectURL(
                        new Blob([output.body], { type: "text/markdown" }),
                      );
                      link.download =
                        output.title.replace(/[^\w -]+/g, "").trim() + ".md";
                      link.click();
                      URL.revokeObjectURL(link.href);
                    }}
                  >
                    Export as Markdown
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      work("snapshot");
                    }}
                  >
                    Refresh
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      setHistory("list");
                    }}
                  >
                    Version history
                  </button>
                  {output.type === acceptanceType ? (
                    <>
                      {(["accepted", "not_yet", "rejected"] as const).map(
                        (decision) => (
                          <button
                            key={decision}
                            role="menuitem"
                            onClick={() => {
                              setMenu(null);
                              setDecisionProblem("");
                              setDeciding(decision);
                            }}
                          >
                            {decision === "accepted"
                              ? "Accept"
                              : decision === "not_yet"
                                ? "Not yet"
                                : "Reject"}
                          </button>
                        ),
                      )}
                      {output.acceptance && (
                        <button
                          role="menuitem"
                          onClick={() => {
                            setMenu(null);
                            work("record-acceptance", {
                              outputId: output.id,
                              decision: null,
                            });
                          }}
                        >
                          Clear my decision
                        </button>
                      )}
                    </>
                  ) : (
                    (openVersion === null ||
                      openVersion === output.version) && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenu(null);
                          work("approve-output", {
                            outputId: output.id,
                            versionNumber: output.version,
                            approved: approvalOf(output).state !== "approved",
                          });
                        }}
                      >
                        {approvalOf(output).state === "approved"
                          ? "Remove approval"
                          : "Mark as approved"}
                      </button>
                    )
                  )}
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(null);
                      work("save-output", {
                        outputId: output.id,
                        groupId: output.groupId,
                        type: output.type,
                        title: output.title,
                        body: output.body,
                        status: "Archived",
                        workAreaIds: output.workAreaIds,
                      });
                      onPane(null);
                    }}
                  >
                    Archive
                  </button>
                </div>
              )}
              <span className="grow" />
              {pane.kind === "happened" && (
                <span className="row" ref={setHappenedControls} />
              )}
              {output && output.section === "output" && (
                <span style={{ position: "relative" }}>
                  <button
                    className="btn quiet"
                    aria-expanded={menu === "mode"}
                    onClick={() => setMenu(menu === "mode" ? null : "mode")}
                  >
                    {editing ? "Editing" : "Viewing"}
                    <Icon
                      name="chevron"
                      width={12}
                      height={12}
                      style={{ rotate: "90deg" }}
                    />
                  </button>
                  {menu === "mode" && (
                    <div
                      className="rb-menu"
                      role="menu"
                      style={{
                        top: "calc(100% + 4px)",
                        right: 0,
                        minWidth: 140,
                      }}
                    >
                      {(["Editing", "Viewing"] as const).map((mode) => (
                        <button
                          key={mode}
                          role="menuitemradio"
                          aria-checked={(mode === "Editing") === editing}
                          onClick={() => {
                            setEditing(mode === "Editing");
                            setMenu(null);
                          }}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              )}
              <button
                className="icon-btn"
                aria-label={
                  expanded ? "Restore the conversation" : "Expand the document"
                }
                onClick={onExpand}
              >
                <Icon name="expand" width={17} height={17} />
              </button>
              <button
                className="icon-btn"
                aria-label={
                  pane.kind === "happened"
                    ? "Close What happened"
                    : "Close the document"
                }
                onClick={() => {
                  inspectView({
                    view: "Back to conversation",
                    areaId,
                    project: area.name,
                    source: "Project panel",
                  });
                  onPane(null);
                }}
              >
                <Icon name="close" width={17} height={17} />
              </button>
            </header>
            <div className="doc">
              {pane.kind === "plan" && (
                <PlanReview
                  key={pane.id}
                  snapshot={snapshot}
                  planId={pane.id}
                />
              )}
              {pane.kind === "browser" && (
                <BrowserPane
                  url={pane.url}
                  hidden={menu !== null || dragging}
                />
              )}
              {pane.kind === "output" && output && history !== null && (
                <VersionHistory
                  item={output}
                  version={history === "list" ? null : history}
                  onOpen={(version) => setHistory(version ?? "list")}
                  onClose={() => setHistory(null)}
                />
              )}
              {pane.kind === "output" && output && deciding && (
                <form
                  className="rb-inline amber"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const reason = String(
                      new FormData(event.currentTarget).get("reason") ?? "",
                    ).trim();
                    const result = await workAsync("record-acceptance", {
                      outputId: output.id,
                      decision: deciding,
                      reason,
                    });
                    if (result.ok) setDeciding(null);
                    else setDecisionProblem(result.message);
                  }}
                >
                  <label className="field">
                    <span>
                      {decisionWords[deciding]}: say why in a few words. This
                      only records your decision; nothing is published or
                      merged.
                    </span>
                    <input
                      name="reason"
                      type="text"
                      maxLength={500}
                      autoFocus
                      required
                    />
                  </label>
                  <span role="alert">{decisionProblem}</span>
                  <div className="row">
                    <button className="btn" type="submit">
                      Save my decision
                    </button>
                    <button
                      className="btn quiet"
                      type="button"
                      onClick={() => setDeciding(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {pane.kind === "output" && history === null && (
                <OutputDoc
                  snapshot={snapshot}
                  areaId={areaId}
                  outputId={pane.id}
                  editing={editing}
                  onAsk={(text) => setSeed({ text, nonce: Date.now() })}
                  onPreview={(url) => onPane({ kind: "browser", url })}
                  citations={citations}
                />
              )}
              {pane.kind === "happened" && (
                <WhatHappened
                  areaId={areaId}
                  focus={pane.stepId ?? null}
                  controls={happenedControls}
                  refreshKey={
                    snapshot.messages.filter(
                      (message) => message.workAreaId === areaId,
                    ).length
                  }
                />
              )}
              {pane.kind === "pulls" &&
                (workspace?.productContext?.productId === area.productId ? (
                  <PullRequests
                    key={workspace.productContext.productId}
                    context={workspace.productContext}
                    workAreaId={areaId}
                    onAsk={(text) => setSeed({ text, nonce: Date.now() })}
                  />
                ) : (
                  <p className="muted" role="status">
                    Opening…
                  </p>
                ))}
              {(pane.kind === "prd" || pane.kind === "backlog") &&
                (workspace?.productContext?.productId === area.productId ? (
                  pane.kind === "prd" ? (
                    <ReviewOrigin.Provider value={{ areaId, chatId }}>
                      <PrdView
                        initialObjective={pane.objectiveId}
                        key={JSON.stringify([
                          workspace.productContext.productId,
                          pane.objectiveId,
                        ])}
                        context={workspace.productContext}
                        openPreview={(url) => onPane({ kind: "browser", url })}
                      />
                    </ReviewOrigin.Provider>
                  ) : (
                    <ReviewOrigin.Provider value={{ areaId, chatId }}>
                      <Backlog
                        key={workspace.productContext.productId}
                        context={workspace.productContext}
                      />
                    </ReviewOrigin.Provider>
                  )
                ) : (
                  <p className="muted" role="status">
                    Opening…
                  </p>
                ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
