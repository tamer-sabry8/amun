// "What happened": a read-only walk through what Firstmate did in this
// conversation, turn by turn. Nothing here starts or re-runs anything; to do
// something again the owner asks Firstmate in the conversation.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  whatHappenedResult,
  type HappenedStep,
  type HappenedTurn,
} from "../../../../packages/contracts/src/work.ts";
import { bridge } from "../bridge.ts";

/** "today 10:41", or "18 Nov 10:41" for another day. */
export function clockLabel(at: string, now = Date.now()) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay
    ? `today ${time}`
    : `${date.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

/** "0.8 s", "12 s", "3 min". */
export function spanLabel(ms: number | null) {
  if (ms === null) return "";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 90_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

const exact = (at: string) => {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour12: false });
};

type Tab = "summary" | "sent" | "back" | "timing";
const tabs: [Tab, string][] = [
  ["summary", "Summary"],
  ["sent", "What it sent"],
  ["back", "What came back"],
  ["timing", "Timing"],
];

function StepPanel({
  step,
  place,
  count,
}: {
  step: HappenedStep;
  place: number;
  count: number;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const end =
    step.durationMs === null
      ? null
      : new Date(Date.parse(step.at) + step.durationMs).toISOString();
  const nothing = (text: string) => <p className="muted">{text}</p>;
  return (
    <div className="rb-happened-panel">
      <div
        className="rb-happened-tabs"
        role="tablist"
        aria-label="Step details"
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "summary" && (
          <>
            <p>
              Firstmate {step.words}
              {step.failed ? ". This step did not work." : "."}
            </p>
            <p className="muted small">
              {exact(step.at)}
              {end ? ` → ${exact(end)}` : ""} · step {place} of {count} in this
              turn
            </p>
          </>
        )}
        {tab === "sent" &&
          (step.sent ? (
            <pre>{step.sent}</pre>
          ) : (
            nothing("This step sent nothing.")
          ))}
        {tab === "back" &&
          (step.cameBack ? (
            <pre>{step.cameBack}</pre>
          ) : (
            nothing("Nothing came back from this step.")
          ))}
        {tab === "timing" && (
          <dl>
            <dt>Started</dt>
            <dd>{exact(step.at)}</dd>
            <dt>Finished</dt>
            <dd>{end ? exact(end) : "Not recorded"}</dd>
            <dt>Took</dt>
            <dd>{spanLabel(step.durationMs) || "Not recorded"}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}

/** True when every word typed is somewhere in the text. */
const holds = (text: string, words: string[]) => {
  const hay = text.toLowerCase();
  return words.every((word) => hay.includes(word));
};

export function WhatHappened({
  areaId,
  focus,
  controls,
  refreshKey,
}: {
  areaId: string;
  /** A step to open at once (from a search result). */
  focus: string | null;
  /** Where Previous step, Next step and Fold all go: the pane's header. */
  controls: HTMLElement | null;
  /** Changes when the conversation gains a message, to read again. */
  refreshKey: number;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; available: boolean; turns: HappenedTurn[] }
  >({ status: "loading" });
  const [open, setOpen] = useState<string | null>(focus);
  const [folded, setFolded] = useState(false);
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const requestId = crypto.randomUUID();
    const stop = bridge.onEvent((raw) => {
      const event = whatHappenedResult.safeParse(raw);
      if (event.success && event.data.requestId === requestId)
        setState({
          status: "ready",
          available: event.data.available,
          turns: event.data.turns,
        });
    });
    bridge.send({
      version: 1,
      kind: "what-happened",
      requestId,
      workAreaId: areaId,
    });
    return stop;
  }, [areaId, refreshKey]);
  useEffect(() => {
    if (focus) {
      setOpen(focus);
      setFolded(false);
    }
  }, [focus]);

  const turns = state.status === "ready" ? state.turns : [];
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () =>
      turns
        .map((turn) => ({
          turn,
          steps: words.length
            ? turn.steps.filter((step) =>
                holds(
                  `${step.words} ${step.script ?? ""} ${step.sent} ${step.cameBack}`,
                  words,
                ),
              )
            : turn.steps,
        }))
        .filter(
          (entry) =>
            !words.length ||
            entry.steps.length ||
            holds(entry.turn.prompt, words),
        ),
    [turns, query],
  );
  const order = shown.flatMap((entry) => entry.steps.map((step) => step.id));
  const at = open ? order.indexOf(open) : -1;
  const move = (by: number) => {
    const next = order[at === -1 ? (by > 0 ? 0 : order.length - 1) : at + by];
    if (!next) return;
    setFolded(false);
    setOpen(next);
  };
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector(`[data-step="${open}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, state.status]);

  const header: ReactNode = (
    <>
      <button
        className="btn quiet"
        disabled={!order.length || at === 0}
        onClick={() => move(-1)}
      >
        Previous step
      </button>
      <button
        className="btn quiet"
        disabled={!order.length || at === order.length - 1}
        onClick={() => move(1)}
      >
        Next step
      </button>
      <button
        className="btn quiet"
        disabled={!turns.length}
        aria-pressed={folded}
        onClick={() => setFolded((value) => !value)}
      >
        {folded ? "Unfold all" : "Fold all"}
      </button>
    </>
  );

  return (
    <div className="rb-happened" ref={list}>
      {controls && createPortal(header, controls)}
      {state.status === "loading" && (
        <p className="muted" role="status">
          Opening…
        </p>
      )}
      {state.status === "ready" && !turns.length && (
        <p className="muted" role="status">
          {state.available
            ? "Nothing to show for this conversation yet. Steps appear here after Firstmate answers a message you send from it."
            : "Firstmate has not done anything since Amun opened. Send it a message, then come back here."}
        </p>
      )}
      {turns.length > 0 && (
        <>
          <input
            type="text"
            aria-label="Search this conversation"
            placeholder="Search this conversation"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {!shown.length && (
            <p className="muted" role="status">
              No step in this conversation matches “{query.trim()}”.
            </p>
          )}
          {shown.map(({ turn, steps }) => (
            <section key={turn.id} className="rb-happened-turn">
              <header>
                <h3>
                  {turn.trigger === "you" ? "You asked" : "Firstmate woke up"}
                </h3>
                <span className="muted small">
                  {clockLabel(turn.at)}
                  {turn.durationMs !== null
                    ? ` · ${spanLabel(turn.durationMs)}`
                    : ""}
                </span>
              </header>
              {turn.prompt.trim() && (
                <p className="rb-happened-prompt">
                  <span className="muted small">
                    {turn.trigger === "you" ? "You" : "What woke it"}
                  </span>{" "}
                  {turn.prompt.trim()}
                </p>
              )}
              {!folded &&
                steps.map((step) => (
                  <div key={step.id} data-step={step.id}>
                    <button
                      className={
                        "rb-happened-step" + (step.failed ? " failed" : "")
                      }
                      aria-expanded={open === step.id}
                      onClick={() => setOpen(open === step.id ? null : step.id)}
                    >
                      <span className="what">
                        <span className="muted small">Firstmate</span>{" "}
                        {step.words}
                        {step.script && <code>{step.script}</code>}
                      </span>
                      <span className="muted small">
                        {spanLabel(step.durationMs)}
                      </span>
                    </button>
                    {open === step.id && (
                      <StepPanel
                        key={step.id}
                        step={step}
                        place={turn.steps.indexOf(step) + 1}
                        count={turn.steps.length}
                      />
                    )}
                  </div>
                ))}
            </section>
          ))}
          <p className="muted small">
            Read only. To do something again, ask Firstmate in the conversation.
          </p>
        </>
      )}
    </div>
  );
}
