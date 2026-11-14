// Work session (handoff §7): conversation on the left, live artifact on the
// right with a draggable divider. Opening a work area lands here directly.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import {
  failureOverflow,
  previewNote,
  updateMessage,
} from "../../../../packages/domain/src/work/home.ts";
import { approveLabel } from "../../../../packages/domain/src/work/permissions.ts";
import {
  rfpAuthoringBoundary,
  scopeCheck,
  planDestinations,
  trackerName,
} from "../../../../packages/domain/src/work/flows.ts";
import {
  maxRatio,
  minRatio,
} from "../../../../packages/domain/src/work/shell.ts";
import { browserBounds, coverSelector } from "./browser-bounds.ts";
import { copyText } from "./clipboard.ts";
import { FirstmateMark } from "./firstmate-mark.tsx";
import { Icon } from "../icons.tsx";
import { Backlog } from "./lazy.tsx";
import { Composer } from "./composer.tsx";
import {
  askFirstmate,
  heldMessage,
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
import { planPlacesResult } from "../../../../packages/contracts/src/work.ts";
import { typeName } from "./rail.tsx";
import { work, workAsync } from "./store.ts";
import {
  amunProtocol,
  areaOf,
  parseAmunActions,
  typeLabels,
  workContext,
  type AmunAction,
  type Snapshot,
} from "./view-model.ts";

const PrdWorkspace = lazy(() =>
  import("../prd-workspace.tsx").then(({ PrdWorkspace }) => ({
    default: PrdWorkspace,
  })),
);

export type PaneTarget =
  | { kind: "output"; id: string }
  | { kind: "plan"; id: string }
  | { kind: "prd" }
  | { kind: "backlog" }
  | { kind: "browser"; url: string }
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
              onClick={() =>
                work("scope-answer", { workAreaId: areaId, item, answer })
              }
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
    const check = updateMessage(text);
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
  const settled = plan.state !== "proposed" && plan.state !== "approved";
  return (
    <span style={{ display: "grid", gap: 4 }}>
      <span style={{ fontWeight: 600 }}>{item.summary}</span>
      {plan.kind !== "roadmap" && !result && (
        <>
          <span className="row wrap small">
            <span className="tag">{trackerName(destination)}</span>
            {place?.place && <span className="muted">{place.place}</span>}
            {place?.problem && (
              <span style={{ color: "var(--amun-status-signed-out)" }}>
                {place.problem}
              </span>
            )}
          </span>
          <span className="muted small">{fields || "No field changes"}</span>
        </>
      )}
      {result?.state === "created" && (
        <span className="row wrap small">
          <span className="tag good">
            Created
            {result.externalId && /^\d+$/.test(result.externalId)
              ? " #" + result.externalId
              : ""}
          </span>
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
              className={"tag " + (result.state === "failed" ? "bad" : "warn")}
            >
              {result.state === "failed" ? "Not created" : "Being checked"}
            </span>
            <span className="muted">
              {result.state === "failed"
                ? (place?.problem ??
                  `${trackerName(destination)} did not accept this. Nothing was duplicated.`)
                : `${trackerName(destination)} did not confirm. Amun looks for it before sending anything again.`}
            </span>
          </span>
          {settled && (
            <span>
              <button
                className="btn"
                onClick={() =>
                  bridge.send({
                    version: 1,
                    kind: "plan-publish",
                    planId: plan.id,
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
  const noun = plan.kind === "stories" ? "story" : "change";
  const proposed = plan.state === "proposed";
  const ticked = plan.items.filter((item) => !skipped.includes(item.id));
  // Items left out of an earlier approval of this plan, still waiting.
  const waiting = snapshot.plans.filter(
    (item) => item.splitFrom === plan.id && item.state === "proposed",
  );
  const pick = proposed && plan.items.length > 1;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2 style={{ fontSize: 20 }}>{plan.summary || "Proposed changes"}</h2>
      <p className="muted">
        To {planDestinations(plan)} · {plan.items.length}{" "}
        {plan.items.length === 1 ? "item" : "items"} ·{" "}
        {proposed ? previewNote(plan.destination) : "Approved"}
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
              disabled={changed || !ticked.length}
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
            <button
              className="btn"
              onClick={() => work("request-changes", { planId: plan.id })}
            >
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

function OutputDoc({
  snapshot,
  areaId,
  outputId,
  editing,
  onAsk,
}: {
  snapshot: Snapshot;
  areaId: string;
  outputId: string;
  editing: boolean;
  onAsk(text: string): void;
}) {
  const item = snapshot.library.find((entry) => entry.id === outputId);
  const [body, setBody] = useState(item?.body ?? "");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setBody(item?.body ?? ""), [outputId]);
  if (!item)
    return <p className="muted">That item is no longer in the Library.</p>;
  const record = item.section === "record";
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
  const insert = (snippet: string) => {
    const element = area.current;
    if (!element) return;
    const at = element.selectionStart;
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
          {!item.workAreaIds.includes(areaId) && (
            <span className="tag">From the Library</span>
          )}
        </div>
        <textarea
          ref={area}
          aria-label={item.title}
          readOnly={!editing || record}
          value={body}
          placeholder={
            record ? "" : "Start writing, or ask Firstmate to draft this."
          }
          onChange={(event) => setBody(event.target.value)}
          onBlur={() => save(body)}
        />
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
          <button
            onClick={() =>
              insert("\n| Column | Column |\n| --- | --- |\n|  |  |\n")
            }
          >
            Table
          </button>
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

export function WorkSession({
  snapshot,
  workspace,
  areaId,
  now,
  model,
  pane,
  ratio,
  expanded,
  first,
  onPane,
  onResize,
  onExpand,
  onGroupNeeded,
  onDiagnostics,
  onSettings,
}: {
  snapshot: Snapshot;
  workspace: WorkspaceSnapshot | null;
  areaId: string;
  now: number;
  model: string | null;
  pane: PaneTarget;
  ratio: number;
  expanded: boolean;
  /** A message typed on Home that opened this session. */
  first: string | null;
  onPane(target: PaneTarget): void;
  onResize(ratio: number): void;
  onExpand(): void;
  onGroupNeeded(): void;
  onDiagnostics(): void;
  onSettings(): void;
}) {
  const context = workContext(snapshot, areaId, now);
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [menu, setMenu] = useState<"title" | "mode" | "area" | "fail" | null>(
    null,
  );
  const [editing, setEditing] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(
    null,
  );
  const [problem, setProblem] = useState("");
  const [copiedLog, setCopiedLog] = useState("");
  /** The name being typed while this work is renamed; null when it is not. */
  const [areaName, setAreaName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const sentFirst = useRef<string | null>(null);

  /** Files what Firstmate proposed under this work area. Proposals only. */
  const raise = (proposed: AmunAction) => {
    const groupId = context?.area.groupId ?? null;
    if (proposed.do === "document")
      work("save-output", {
        groupId,
        type: proposed.type,
        title: proposed.title,
        body: proposed.body,
        workAreaIds: [areaId],
      });
    else if (proposed.do === "plan")
      work("propose-plan", {
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
    else if (proposed.do === "question" || proposed.do === "offer")
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
    else if (proposed.do === "rename")
      // Done at once: it stays inside Amun and is undone by renaming again.
      work("update-area", { areaId, patch: { name: proposed.name } });
    else if (proposed.do === "delete")
      // Deleting is the owner's call: Firstmate can only ask.
      work("message", {
        workAreaId: areaId,
        role: "card",
        text: "Delete this work?",
        card: { kind: "delete-work" },
      });
    else if (proposed.do === "update")
      work("message", {
        workAreaId: areaId,
        role: "card",
        text: proposed.message,
        card: { kind: "update", message: proposed.message },
      });
    else if (groupId)
      work("rule-case", {
        groupId,
        situation: proposed.situation,
        resolution: proposed.resolution,
        eventId: crypto.randomUUID(),
      });
  };
  const [waiting, setWaiting] = useState(() => heldMessage(areaId));
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
  ) => {
    if (inFlight.has(areaId)) return;
    inFlight.add(areaId);
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
    const turn = await askFirstmate(scoped, image);
    setBusy(false);
    inFlight.delete(areaId);
    if (turn.ok) {
      const parsed = parseAmunActions(turn.reply);
      const renamed = parsed.actions.find((item) => item.do === "rename");
      // A rename always gets a plain confirmation, even from a silent reply.
      const said =
        parsed.text ||
        (renamed?.do === "rename"
          ? `Done. This is now called “${renamed.name}”.`
          : "");
      if (said)
        work("message", {
          workAreaId: areaId,
          role: "firstmate",
          text: said,
        });
      if (briefing) markBriefed();
      for (const proposed of parsed.actions) raise(proposed);
      if (retry) {
        releaseMessage(areaId);
        setWaiting(null);
      }
    } else if (turn.needsProvider || retry) {
      // Kept, not failed: it goes out once a provider is connected.
      const message = { text, scoped, activityId: row, image };
      holdMessage(areaId, message);
      setWaiting(message);
      return;
    } else setProblem(turn.reason);
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
  const send = async (typed: string) => {
    if ((!typed.trim() && !attachments.files.length) || !context) return;
    // Files in the draft travel with this message.
    const files = await attachments.take();
    const text =
      typed.trim() || `Attached ${files.map((file) => file.name).join(", ")}`;
    // One message waits at a time; a new one replaces the wait, not the text.
    releaseMessage(areaId);
    setWaiting(null);
    await workAsync("message", { workAreaId: areaId, role: "you", text });
    // A conversation that has not been told Amun's rules gets them with this
    // message: the first one for a work area, and the first after Firstmate's
    // conversation was started afresh.
    const briefing = !context.messages.length || needsBriefing();
    const scoped = briefing
      ? `${amunProtocol}\n\n[${typeLabels[context.area.type]}: ${context.area.name}${context.group ? " · " + context.group : ""}]\n${text}`
      : text;
    await deliver(
      text,
      files.length ? `${scoped}\n\n${attachmentBlock(files)}` : scoped,
      null,
      files.find((file) => file.image)?.image ?? undefined,
      false,
      briefing,
    );
  };
  /** Tries the waiting message again. It leaves the wait before it is sent. */
  const retryWaiting = () => {
    // One attempt at a time per work area, so it can only go out once. It
    // stays saved and on screen as waiting until Firstmate has answered.
    const message = heldMessage(areaId);
    if (!message || inFlight.has(areaId)) return;
    void deliver(
      message.text,
      message.scoped,
      message.activityId ?? null,
      message.image,
      true,
      message.scoped.startsWith(amunProtocol),
    );
  };
  useEffect(() => {
    // Returning to this conversation: one attempt for a message left waiting.
    setWaiting(heldMessage(areaId));
    if (heldMessage(areaId)) retryWaiting();
  }, [areaId]);
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
  }, [areaId, !!waiting]);
  useEffect(() => {
    if (first && context && sentFirst.current !== first) {
      sentFirst.current = first;
      void send(first);
    }
  }, [first, areaId, !!context]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [context?.messages.length, busy]);
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
  const open = pane !== null;
  const questions = snapshot.attention.filter(
    (item) =>
      item.kind === "question" &&
      item.state === "open" &&
      item.workAreaId === areaId,
  );
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
          {area.convertedFrom && <span className="tag">Was a task</span>}
          <span className="grow" />
          {area.productId && !open && (
            <>
              <button
                className="btn quiet"
                onClick={() => onPane({ kind: "prd" })}
              >
                PRD
              </button>
              <button
                className="btn quiet"
                onClick={() => onPane({ kind: "backlog" })}
              >
                Backlog
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
                onClick={() =>
                  send(
                    `${context.failure!.options[0]}: check what already exists first, then continue.`,
                  )
                }
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
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    onDiagnostics();
                  }}
                >
                  {failureOverflow[0]}
                </button>
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
        <div className="rb-thread">
          <div className="inner">
            <div className="msgs">
              {!context.messages.length && !busy && (
                <p className="muted">
                  {area.purpose ||
                    (area.type === "rfp"
                      ? rfpAuthoringBoundary
                      : `Tell Firstmate what you want done for ${area.name}.`)}
                </p>
              )}
              {context.objective && (
                <div className="rb-inline" aria-label="Objective">
                  <div className="row">
                    <strong className="grow">{context.objective.metric}</strong>
                    <span
                      className={
                        "tag " +
                        (context.objective.progress.state === "reached"
                          ? "good"
                          : context.objective.progress.state === "conflict"
                            ? "warn"
                            : "")
                      }
                    >
                      {context.objective.progress.label}
                    </span>
                  </div>
                  {"ratio" in context.objective.progress && (
                    <div className="rb-capacity" aria-hidden="true">
                      <i
                        style={{
                          width: `${(context.objective.progress.ratio ?? 0) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
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
                message.role === "card" ? (
                  <InlineCard
                    key={message.id}
                    snapshot={snapshot}
                    areaId={areaId}
                    card={
                      (message.card ?? {
                        kind: "note",
                        text: message.text,
                      }) as Card
                    }
                  />
                ) : (
                  <div key={message.id} className={"rb-msg " + message.role}>
                    {/* Firstmate is named where its turn begins, on the left;
                        the owner's own messages sit on the right. */}
                    {message.role === "firstmate" &&
                      context.messages[position - 1]?.role !== "firstmate" && (
                        <span className="who">
                          <FirstmateMark size={18} />
                          Firstmate
                        </span>
                      )}
                    {message.text}
                  </div>
                ),
              )}
              {waiting && (
                <>
                  <span
                    className="tag warn"
                    style={{ justifySelf: "end" }}
                    role="status"
                  >
                    Waiting to send
                  </span>
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
                          releaseMessage(areaId);
                          setWaiting(null);
                        }}
                      >
                        Discard message
                      </button>
                    </div>
                  </div>
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
                  <span className="note">{previewNote(plan.destination)}</span>
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
                      <span className="tag">{item.status}</span>
                    </span>
                    <span className="note">
                      {typeName(item.type)} · opens beside the conversation
                    </span>
                  </button>
                ))}
              {questions.map((question) => (
                <div
                  className="rb-inline"
                  key={question.id}
                  role="group"
                  aria-label="Question from Firstmate"
                >
                  <strong>{question.title}</strong>
                  {question.detail && <span>{question.detail}</span>}
                  <div className="row wrap">
                    {question.options.map((option) => (
                      <button
                        key={option}
                        className="btn"
                        onClick={() =>
                          work("resolve-attention", {
                            attentionId: question.id,
                            resolution: "answer",
                            answer: option,
                          })
                        }
                      >
                        {option}
                      </button>
                    ))}
                    <button
                      className="btn quiet"
                      onClick={() => setSeed({ text: "", nonce: Date.now() })}
                    >
                      Write my own response
                    </button>
                  </div>
                  <span className="note">
                    Only the work that depends on this waits. Nothing is
                    assumed.
                  </span>
                </div>
              ))}
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
              <div ref={end} />
            </div>
          </div>
        </div>
        <Composer
          key={seed?.nonce ?? "composer"}
          initial={seed?.text ?? ""}
          autoFocus
          busy={busy}
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
            <header>
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
                aria-label="Close the document"
                onClick={() => onPane(null)}
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
              {pane.kind === "output" && (
                <OutputDoc
                  snapshot={snapshot}
                  areaId={areaId}
                  outputId={pane.id}
                  editing={editing}
                  onAsk={(text) => setSeed({ text, nonce: Date.now() })}
                />
              )}
              {(pane.kind === "prd" || pane.kind === "backlog") &&
                (workspace?.productContext?.productId === area.productId ? (
                  <div className="legacy-surface" style={{ maxWidth: "none" }}>
                    {pane.kind === "prd" ? (
                      <Suspense
                        fallback={<p role="status">Opening the PRD…</p>}
                      >
                        <PrdWorkspace
                          key={workspace.productContext.productId}
                          context={workspace.productContext}
                          mode="Write"
                          setMode={() => undefined}
                          openPreview={() => undefined}
                        />
                      </Suspense>
                    ) : (
                      <Backlog
                        key={workspace.productContext.productId}
                        context={workspace.productContext}
                      />
                    )}
                  </div>
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
