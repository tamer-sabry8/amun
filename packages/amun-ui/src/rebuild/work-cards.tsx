// Portfolio's progress cards for products and projects, and the panel that
// opens over the page when one is clicked. The owner approved both on
// 20 November 2026 (docs/preview/2026-11-20-portfolio-rfps).
//
// Done %, story counts, pull requests and the people on the work come from
// Azure DevOps. That reading is not wired yet, so `progress` is null for
// every work and those parts say so instead of showing a made-up figure.
import { useEffect, useRef, useState } from "react";
import {
  blockerLine,
  openBlockers,
} from "../../../../packages/domain/src/work/blockers.ts";
import {
  portfolioCard,
  type WorkProgress,
} from "../../../../packages/domain/src/work/portfolio.ts";
import { Icon } from "../icons.tsx";
import {
  groupName,
  typeLabels,
  type Area,
  type Snapshot,
} from "./view-model.ts";

const shortDay = (stamp: string) =>
  new Date(stamp).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const label = (text: string) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
const priorityLine = (area: Area) =>
  [area.client, area.priority ? label(area.priority) + " priority" : null]
    .filter(Boolean)
    .join(" · ");

function Ring({
  percent,
  tone,
  size,
}: {
  percent: number | null;
  tone: "good" | "bad";
  size: number;
}) {
  const around = 2 * Math.PI * 34;
  return (
    <svg
      className={"rb-ring " + tone}
      width={size}
      height={size}
      style={{ inlineSize: size, blockSize: size }}
      viewBox="0 0 84 84"
      role="img"
      aria-label={percent === null ? "Progress not known" : `${percent}% done`}
    >
      <circle cx="42" cy="42" r="34" className="track" />
      {percent !== null && percent > 0 && (
        <circle
          cx="42"
          cy="42"
          r="34"
          className="arc"
          strokeDasharray={`${(around * percent) / 100} ${around}`}
          transform="rotate(-90 42 42)"
        />
      )}
    </svg>
  );
}

/** What Amun knows of a work's progress. Null until Azure DevOps is read. */
export function workProgress(area: Area): WorkProgress | null {
  // Nothing reads Azure DevOps for this yet, whatever the work is.
  void area;
  return null;
}

export function ProgressCard({
  area,
  snapshot,
  now,
  onOpen,
}: {
  area: Area;
  snapshot: Snapshot;
  now: number;
  onOpen(): void;
}) {
  const progress = workProgress(area);
  const card = portfolioCard(area, now, progress);
  const tone = card.atRisk ? "bad" : "good";
  const waiting = snapshot.attention.filter(
    (item) => item.workAreaId === area.id && item.state === "open",
  ).length;
  const blocked = openBlockers(snapshot.blockers, area.id).length;
  const running = snapshot.activity.some(
    (item) => item.workAreaId === area.id && item.state === "running",
  );
  const group = groupName(snapshot, area.groupId);
  return (
    <button
      className={"rb-pcard" + (card.atRisk ? " late" : "")}
      onClick={onOpen}
    >
      <span className="top">
        <span className={"rb-pill " + tone}>{label(area.status)}</span>
        <span className="tags">
          {group && <span className="rb-chip team">{group}</span>}
          <span className="rb-chip">{typeLabels[area.type]}</span>
        </span>
      </span>
      <span className="name">{area.name}</span>
      <span className="sub">{priorityLine(area) || "No client set"}</span>
      <span className="prog">
        <Ring percent={progress?.donePercent ?? null} tone={tone} size={84} />
        <span className="days">
          <strong className={card.atRisk ? "bad" : undefined}>
            {card.daysText}
          </strong>
          <span>{card.daysLabel}</span>
          <small>Due {area.dueAt ? shortDay(area.dueAt) : "—"}</small>
        </span>
        <span className={"done rb-dot-label " + tone}>
          Done <b>{progress ? progress.donePercent + "%" : "—"}</b>
        </span>
      </span>
      <span className="line">{card.line}</span>
      <span className="foot">
        <span>
          {running
            ? "Firstmate is working on it"
            : blocked
              ? `${blocked} blocked`
              : "Nothing running"}
        </span>
        {waiting > 0 && (
          <span className="waiting">{waiting} waiting for you</span>
        )}
      </span>
    </button>
  );
}

type Tab = "summary" | "stories" | "pulls" | "activity" | "history";

/** One product or project, over the page. */
export function WorkSheet({
  area,
  snapshot,
  now,
  onClose,
  onWork,
  onAsk,
  onAskAbout,
}: {
  area: Area;
  snapshot: Snapshot;
  now: number;
  onClose(): void;
  /** Opens the work's conversation. */
  onWork(areaId: string): void;
  /** A fresh chat in this folder with the card attached; sends nothing. */
  onAskAbout?(areaId: string): void;
  /** Opens the conversation with a message for Firstmate. */
  onAsk(areaId: string, text: string): void;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const sheet = useRef<HTMLDivElement>(null);
  const progress = workProgress(area);
  const card = portfolioCard(area, now, progress);
  const tone = card.atRisk ? "bad" : "good";
  const blockers = openBlockers(snapshot.blockers, area.id);
  const waiting = snapshot.attention.filter(
    (item) => item.workAreaId === area.id && item.state === "open",
  );
  const activity = snapshot.activity
    .filter((item) => item.workAreaId === area.id)
    .slice(0, 30);
  const decisions = snapshot.decisions.filter(
    (item) => item.workAreaId === area.id,
  );

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>("[data-first]")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const fact = (name: string, value: string, bad = false) => (
    <div className="rb-fact">
      <span>{name}</span>
      <b className={bad ? "bad" : undefined}>{value}</b>
    </div>
  );
  const needsAzure = (what: string) => (
    <p className="muted">
      Link this {typeLabels[area.type].toLowerCase()} to Azure DevOps to see{" "}
      {what} here.
    </p>
  );

  return (
    <div
      className="rb-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="rb-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={area.name}
        ref={sheet}
      >
        <header className="top">
          <span className={"rb-pill " + tone}>{label(area.status)}</span>
          <span className="rb-chip">{typeLabels[area.type]}</span>
          <span className="grow" />
          {onAskAbout && (
            <button
              className="btn"
              onClick={() => {
                onClose();
                onAskAbout(area.id);
              }}
            >
              Ask about {area.name}
            </button>
          )}
          <button
            className="btn solid"
            onClick={() => {
              onClose();
              onWork(area.id);
            }}
          >
            Open conversation
            <Icon name="arrowRight" width={14} height={14} aria-hidden />
          </button>
          <button
            className="icon-btn"
            aria-label="Close"
            data-first
            onClick={onClose}
          >
            <Icon name="close" width={16} height={16} />
          </button>
        </header>
        <h2 className="title">{area.name}</h2>

        <div className="rb-sheet-top">
          <Ring
            percent={progress?.donePercent ?? null}
            tone={tone}
            size={120}
          />
          <div className="rb-facts">
            {fact(
              "Work done",
              progress ? progress.donePercent + "%" : "—",
              card.atRisk && !!progress,
            )}
            {fact("Start", shortDay(area.createdAt))}
            {fact(
              "Likely finish",
              area.dueAt ? shortDay(area.dueAt) : "—",
              card.atRisk,
            )}
            {fact("Type", typeLabels[area.type])}
            {fact("Priority", area.priority ? label(area.priority) : "—")}
            {fact("Client", area.client ?? "—")}
            {fact("Group", groupName(snapshot, area.groupId) ?? "—")}
          </div>
        </div>

        {(blockers.length > 0 || waiting.length > 0 || card.atRisk) && (
          <div className="rb-flags">
            {card.atRisk && <span>{card.line}</span>}
            {blockers.map((item) => (
              <span key={item.id}>
                Blocked: {item.title} · {blockerLine(item, now)}
              </span>
            ))}
            {waiting.length > 0 && (
              <span>
                {waiting.length}{" "}
                {waiting.length === 1 ? "thing is" : "things are"} waiting for
                you
              </span>
            )}
          </div>
        )}

        <section className="rb-teambox" aria-label="Team">
          <h3>Team</h3>
          {needsAzure("the people on it and their stories")}
        </section>

        <div className="rb-tabs" role="tablist" aria-label="Sections">
          {(
            [
              ["summary", "Summary"],
              ["stories", "Stories"],
              ["pulls", "Pull requests"],
              ["activity", "Activity"],
              ["history", "History"],
            ] as const
          ).map(([id, name]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {name}
            </button>
          ))}
        </div>

        <div className="rb-sheet-body" role="tabpanel">
          {tab === "summary" && (
            <>
              <div className="rb-sum-head">
                <h3>Current summary</h3>
                <button
                  className="btn solid"
                  onClick={() => {
                    onClose();
                    onAsk(
                      area.id,
                      `Give me a short summary of ${area.name}: where it stands, what changed, and what needs my attention.`,
                    );
                  }}
                >
                  Ask Firstmate for a summary
                </button>
              </div>
              <p className={area.purpose ? undefined : "muted"}>
                {area.purpose ||
                  "No summary yet. Firstmate writes a short paragraph: where it stands, what changed, and what needs attention."}
              </p>
            </>
          )}
          {tab === "stories" && needsAzure("its stories")}
          {tab === "pulls" && needsAzure("its pull requests")}
          {tab === "activity" &&
            (activity.length ? (
              <ol className="rb-notes">
                {activity.map((item) => (
                  <li key={item.id}>
                    <span className="muted small">
                      {label(item.state)} · {shortDay(item.createdAt)}
                    </span>
                    <p>{item.text}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Nothing has run for this yet.</p>
            ))}
          {tab === "history" &&
            (decisions.length ? (
              <ol className="rb-notes">
                {decisions.map((item) => (
                  <li key={item.id}>
                    <span className="muted small">
                      Decision
                      {item.decidedAt ? " · " + shortDay(item.decidedAt) : ""}
                    </span>
                    <p>
                      {item.what}
                      {item.outcome ? `: ${item.outcome}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No decisions recorded for this yet.</p>
            ))}
        </div>
      </div>
    </div>
  );
}
