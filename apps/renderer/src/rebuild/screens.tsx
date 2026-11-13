// The six sidebar destinations (handoff §9): Agents · Council · Roadmap ·
// Sprints · Portfolio · RFPs. Each is driven by the composer plus a few
// direct manipulations; committing anything goes through an approval.
import { agentProfile } from "../../../../packages/domain/src/work/agents.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import { useState, type DragEvent, type ReactNode } from "react";
import {
  horizonBoard,
  orgChart,
  planSummary,
  calendarNote,
  releaseGroups,
  riceBadge,
  roadmapViews,
  sprintOverview,
  sprintRow,
  sprintTabs,
  sprintViews,
  timelineBar,
  type AgentNode,
  type Horizon,
} from "../../../../packages/domain/src/work/planning.ts";
import {
  rfpCard,
  rfpClosed,
  rfpHandoff,
  rfpStageLabels,
  rfpStages,
  rfpAuthoringBoundary,
  trackerName,
  type RfpStage,
} from "../../../../packages/domain/src/work/flows.ts";
import {
  parseCouncilCommand,
  simulationLabel,
  suggestFullCouncil,
} from "../../../../packages/domain/src/work/council.ts";
import { outcomeNotes } from "../../../../packages/domain/src/work/home.ts";
import { Icon } from "../icons.tsx";
import { AgentsPanel } from "./lazy.tsx";
import { Composer } from "./composer.tsx";
import { BrowserPane } from "./work-session.tsx";
import { council as councilCommand, work, workAsync } from "./store.ts";
import {
  areaOf,
  groupName,
  shortDate,
  typeLabels,
  visibleGroups,
  type Area,
  type Snapshot,
} from "./view-model.ts";

const dayMs = 86_400_000;
function Page({
  title,
  context,
  line,
  actions,
  children,
  footer,
}: {
  title: string;
  context?: string;
  line?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="rb-scroll">
      <div className="rb-page">
        <header className="rb-head">
          {context && <span className="context">{context}</span>}
          <h1>{title}</h1>
          {line && <p className="muted">{line}</p>}
          {actions && (
            <div className="row wrap" style={{ marginTop: 10 }}>
              {actions}
            </div>
          )}
        </header>
        {children}
        {footer}
      </div>
    </div>
  );
}
function areasInScope(snapshot: Snapshot) {
  const groups = visibleGroups(snapshot);
  return snapshot.areas.filter(
    (area) => groups === null || !area.groupId || groups.includes(area.groupId),
  );
}
function WorkFilter({
  areas,
  value,
  onChange,
}: {
  areas: Area[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <span className="row muted small">
      Work
      <select
        aria-label="Work area"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All work areas</option>
        {areas.map((area) => (
          <option key={area.id} value={area.id}>
            {area.name}
          </option>
        ))}
      </select>
    </span>
  );
}
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="rb-seg" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// ── Agents ───────────────────────────────────────────────────────────────────
function AgentTree({
  node,
  selected,
  onSelect,
}: {
  node: AgentNode;
  selected: string | null;
  onSelect(id: string): void;
}) {
  return (
    <li>
      <button
        className={"rb-agent" + (node.fading ? " fading" : "")}
        aria-pressed={selected === node.id}
        onClick={() => onSelect(node.id)}
      >
        {agentProfile(node.role) ? (
          <span style={{ gridRow: "span 2" }}>
            <AgentAvatar role={node.role} size={30} />
          </span>
        ) : (
          <span className="glyph" aria-hidden="true">
            <Icon name={node.icon} width={16} height={16} />
          </span>
        )}
        <span className="role">
          {node.role}
          <span className={"rb-live " + node.state} title={node.status} />
        </span>
        <span className="doing">
          {node.nowDoing ??
            (node.kind === "lead"
              ? "Your lead agent"
              : node.kind === "always_on"
                ? "Always on"
                : "Temporary")}
        </span>
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <AgentTree
              key={child.id}
              node={child}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
export function Agents({
  snapshot,
  model,
}: {
  snapshot: Snapshot;
  model: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [watch, setWatch] = useState(false);
  const [problem, setProblem] = useState("");
  const chart = orgChart(snapshot.agents.filter((agent) => agent.enabled));
  const agent = snapshot.agents.find((item) => item.id === selected);
  return (
    <Page
      title="Agents"
      line="Firstmate leads. Agents do the work you delegate."
      footer={
        <>
          {problem && (
            <p className="muted small" role="status">
              {problem}
            </p>
          )}
          <Composer
            placeholder="Describe an agent to add, e.g. a pricing analyst who reads competitor sites"
            chips={["Add an agent"]}
            model={model}
            onSend={async (text) => {
              const result = await workAsync("add-agent", {
                description: text.replace(/^add an agent:?\s*/i, "") || text,
              });
              setProblem(result.ok ? "" : result.message);
              if (result.ref) setSelected(result.ref);
            }}
          />
        </>
      }
    >
      {chart ? (
        <ol className="rb-org" style={{ listStyle: "none", margin: 0 }}>
          <AgentTree
            node={chart}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setWatch(false);
            }}
          />
        </ol>
      ) : (
        <p className="muted">Finish setup to meet Firstmate and your agents.</p>
      )}
      {agent && (
        <section
          className="rb-panel"
          aria-label={agent.role}
          style={{ marginTop: 8 }}
        >
          <header>
            <h2>{agent.role}</h2>
            <span className="tag">
              {agent.kind === "lead"
                ? "Lead agent"
                : agent.kind === "always_on"
                  ? "Always on"
                  : "Temporary"}
            </span>
            <span className="grow" />
            <button
              className="btn"
              aria-pressed={watch}
              onClick={() => setWatch(!watch)}
            >
              Watch
            </button>
            {agent.kind !== "lead" && (
              <button
                className="btn quiet"
                onClick={() => {
                  work("toggle-agent", { agentId: agent.id, enabled: false });
                  setSelected(null);
                }}
              >
                Remove
              </button>
            )}
          </header>
          <div style={{ padding: "0 18px 18px", display: "grid", gap: 10 }}>
            <p>
              <span className="muted">Now doing · </span>
              {agent.nowDoing ?? "Nothing right now"}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>
              <span className="muted">Output so far · </span>
              {agent.output || "No output yet"}
            </p>
            {watch && (
              // The live, read-only session view from the delivery runtime.
              <div className="legacy-surface">
                <AgentsPanel onOpenWorker={() => undefined} />
              </div>
            )}
          </div>
        </section>
      )}
    </Page>
  );
}

// ── Council ──────────────────────────────────────────────────────────────────
import type { CouncilStatus } from "../../../../packages/contracts/src/work.ts";
export function Council({
  snapshot,
  status,
  model,
  onStart,
  onWork,
  problem = "",
}: {
  snapshot: Snapshot;
  status: CouncilStatus | null;
  model: string | null;
  onStart(text: string, workAreaId: string | null): void;
  onWork(areaId: string): void;
  /** Why the last council could not start, if it could not. */
  problem?: string;
}) {
  const areas = areasInScope(snapshot);
  const [areaId, setAreaId] = useState("");
  const [note, setNote] = useState("");
  const groups = visibleGroups(snapshot);
  const sessions = snapshot.council.filter(
    (session) =>
      groups === null || !session.groupId || groups.includes(session.groupId),
  );
  const ready = !!status?.installed && status.claude;
  return (
    <Page
      title="Council"
      line="Put a hard decision to a board of advisors. They debate; you decide."
      actions={
        <>
          {status?.installed && (
            <button
              className="btn"
              onClick={() =>
                councilCommand(status.roomUrl ? "close-room" : "room")
              }
            >
              {status.roomUrl ? "Close the room" : "Open the room"}
            </button>
          )}
          <label className="row muted small">
            Linked to
            <select
              value={areaId}
              onChange={(event) => setAreaId(event.target.value)}
            >
              <option value="">Not linked to work</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>
        </>
      }
      footer={
        <>
          {(note || problem) && (
            <p className="muted small" role="status">
              {note || problem}
            </p>
          )}
          <Composer
            placeholder="/roast-room Should we…, or describe the decision"
            chips={
              ready
                ? ["/roast-room ", "/roast-room ask ", "/roast-room board"]
                : []
            }
            model={model}
            onSend={(text) => {
              const command = parseCouncilCommand(
                text.startsWith("/") ? text : "/roast-room " + text,
              );
              if (!command || command.kind === "error") {
                setNote(
                  command?.message ??
                    "Describe the decision you want the Council to weigh.",
                );
                return;
              }
              if (!ready) {
                setNote(
                  status?.installed
                    ? "The Council runs on Claude Code. Install or sign in to Claude Code on this Mac, then try again."
                    : "The Council’s advisors are not installed yet. See Settings › Council.",
                );
                return;
              }
              setNote(
                command.kind === "council" &&
                  command.mode === "quick" &&
                  suggestFullCouncil(command.decision)
                  ? "Started a quick council. This looks costly or hard to undo; add --all for the full board."
                  : "",
              );
              onStart(
                text.startsWith("/") ? text : "/roast-room " + text,
                areaId || null,
              );
            }}
          />
        </>
      }
    >
      {!ready && (
        <p className="rb-notice">
          <span>
            {status === null
              ? "Checking the Council…"
              : !status.installed
                ? "The Council’s advisors are not installed yet, so sessions cannot start."
                : "The Council runs on Claude Code, which was not found on this Mac."}
          </span>
        </p>
      )}
      <p className="muted small" style={{ marginBottom: 16 }}>
        {simulationLabel} A verdict is advice: it never changes a roadmap,
        backlog or ticket.
      </p>
      {status && status.seats.length > 0 && (
        <div className="row wrap" style={{ marginBottom: 20 }}>
          {status.seats.map((seat) => (
            <span
              key={seat.key}
              className="tag"
              style={{ opacity: seat.disabled ? 0.5 : 1 }}
            >
              {seat.name}
              <span className="muted">· simulation</span>
            </span>
          ))}
        </div>
      )}
      {status?.roomUrl && (
        <section
          className="rb-panel"
          aria-label="The room"
          style={{ height: 520, padding: 12, marginBottom: 20 }}
        >
          <BrowserPane url={status.roomUrl} hidden={false} />
        </section>
      )}
      <section className="rb-panel" aria-labelledby="rb-council-h">
        <header>
          <h2 id="rb-council-h">Sessions</h2>
          <span className="count">{sessions.length}</span>
        </header>
        {sessions.length ? (
          sessions.map((session) => {
            const area = areaOf(snapshot, session.workAreaId);
            return (
              <div
                className="rb-att"
                key={session.id}
                style={{ cursor: "default" }}
              >
                <div>
                  <div className="label">
                    {[
                      shortDate(session.createdAt),
                      session.mode,
                      area?.name ?? "Not linked",
                    ].join(" · ")}
                  </div>
                  <div className="title">{session.decision}</div>
                  {session.recommendation && (
                    <div className="detail">{session.recommendation}</div>
                  )}
                </div>
                <div className="row">
                  <span
                    className={
                      "tag " +
                      (session.state === "finished"
                        ? "good"
                        : session.state === "failed"
                          ? "bad"
                          : session.state === "waiting_on_you"
                            ? "warn"
                            : "accent")
                    }
                  >
                    {session.state === "running"
                      ? "In session"
                      : session.state === "waiting_on_you"
                        ? "Waiting on you"
                        : session.state === "finished"
                          ? "Verdict ready"
                          : "Did not finish"}
                  </span>
                  {area && (
                    <button className="btn" onClick={() => onWork(area.id)}>
                      Open work
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <p className="rb-empty">
            Past councils and their verdicts appear here.
          </p>
        )}
      </section>
    </Page>
  );
}

// ── Roadmap ──────────────────────────────────────────────────────────────────
const horizonLabels: Record<Horizon, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
};
export function Roadmap({
  snapshot,
  model,
  onReview,
}: {
  snapshot: Snapshot;
  model: string | null;
  onReview(planId: string, workAreaId: string | null): void;
}) {
  const [view, setView] = useState<(typeof roadmapViews)[number][0]>("horizon");
  const [areaId, setAreaId] = useState("");
  const [over, setOver] = useState<Horizon | null>(null);
  const [note, setNote] = useState("");
  const areas = areasInScope(snapshot).filter(
    (area) => area.type === "product" || area.type === "project",
  );
  const allowed = new Set(areas.map((area) => area.id));
  const items = snapshot.roadmap.filter(
    (item) =>
      allowed.has(item.workAreaId) && (!areaId || item.workAreaId === areaId),
  );
  const drop = async (event: DragEvent, horizon: Horizon, index: number) => {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain");
    if (!id) return;
    const result = await workAsync("move-roadmap-item", {
      itemId: id,
      horizon,
      index,
    });
    const step = result.step as {
      needsApproval?: boolean;
      planId?: string;
    } | null;
    setNote(result.message);
    if (step?.needsApproval && step.planId)
      onReview(
        step.planId,
        snapshot.roadmap.find((item) => item.id === id)?.workAreaId ?? null,
      );
  };
  const tile = (item: (typeof items)[number]) => {
    const badge = riceBadge(item);
    return (
      <div
        key={item.id}
        className="rb-tile"
        draggable
        onDragStart={(event) =>
          event.dataTransfer.setData("text/plain", item.id)
        }
      >
        <span className="name">{item.title}</span>
        <span className="meta">{areaOf(snapshot, item.workAreaId)?.name}</span>
        <span className="row wrap">
          {badge && (
            <span className="tag accent">
              {badge.text}
              {badge.label && <span className="muted">· {badge.label}</span>}
            </span>
          )}
          {item.committed ? (
            <span className="tag good">Committed</span>
          ) : (
            <button
              className="link small"
              onClick={async () => {
                const plan = await workAsync("propose-plan", {
                  groupId: null,
                  workAreaId: item.workAreaId,
                  planKind: "roadmap",
                  destination: "amun",
                  summary: `Commit “${item.title}” to the roadmap`,
                  items: [
                    {
                      id: item.id,
                      summary: `${item.title} · ${horizonLabels[item.horizon]}`,
                      fields: {
                        horizon: item.horizon,
                        position: item.position,
                      },
                    },
                  ],
                });
                if (plan.ref) onReview(plan.ref, item.workAreaId);
              }}
            >
              Commit…
            </button>
          )}
          {item.release && <span className="tag">{item.release}</span>}
        </span>
      </div>
    );
  };
  const dated = items.filter((item) => item.start && item.end);
  const start = dated.length
    ? new Date(Math.min(...dated.map((item) => Date.parse(item.start!))))
    : new Date();
  const from = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  const to = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 4, 1),
  );
  const months = [0, 1, 2, 3].map((offset) =>
    new Intl.DateTimeFormat("en-GB", {
      month: "short",
      year: "2-digit",
    }).format(
      new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1)),
    ),
  );
  return (
    <Page
      title="Roadmap"
      line="Drag to resequence. Changing what is committed needs your approval."
      actions={
        <>
          <Segmented<(typeof roadmapViews)[number][0]>
            label="View"
            options={roadmapViews}
            value={view}
            onChange={setView}
          />
          <WorkFilter areas={areas} value={areaId} onChange={setAreaId} />
        </>
      }
      footer={
        <>
          {note && (
            <p className="muted small" role="status">
              {note}
            </p>
          )}
          <Composer
            placeholder={
              areaId
                ? "Add to the roadmap, e.g. Bulk upload"
                : "Choose a work area above, then add an item"
            }
            chips={["/prioritize"]}
            model={model}
            onSend={async (text) => {
              if (!areaId) {
                setNote(
                  "Choose which product or project this belongs to first.",
                );
                return;
              }
              const result = await workAsync("save-roadmap-item", {
                workAreaId: areaId,
                title: text.replace(/^add:?\s*/i, ""),
                horizon: "later",
                reach: null,
                impact: null,
                confidence: null,
                effort: null,
              });
              setNote(
                result.ok ? "Added to Later as a draft." : result.message,
              );
            }}
          />
        </>
      }
    >
      {!items.length && (
        <p className="muted">
          Nothing on the roadmap yet. Add an item below, or ask Firstmate to
          propose one from a PRD.
        </p>
      )}
      {view === "horizon" && items.length > 0 && (
        <div className="rb-board">
          {horizonBoard(items).map((column) => (
            <section
              key={column.horizon}
              className={"rb-col" + (over === column.horizon ? " over" : "")}
              aria-label={horizonLabels[column.horizon]}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(column.horizon);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(event) =>
                drop(event, column.horizon, column.items.length)
              }
            >
              <header>
                {horizonLabels[column.horizon]}
                <span className="count">{column.items.length}</span>
              </header>
              {column.items.map(tile)}
            </section>
          ))}
        </div>
      )}
      {view === "release" && items.length > 0 && (
        <div className="rb-board">
          {releaseGroups(items).map((group) => (
            <section
              key={group.release}
              className="rb-col"
              aria-label={group.release}
            >
              <header>
                {group.release}
                <span className="count">{group.items.length}</span>
              </header>
              {group.items.map(tile)}
            </section>
          ))}
        </div>
      )}
      {view === "timeline" && items.length > 0 && (
        <div className="rb-timeline">
          <span />
          <div className="axis">
            {months.map((month) => (
              <span key={month}>{month}</span>
            ))}
          </div>
          {items.map((item) => {
            const bar = timelineBar(item, {
              start: from.toISOString(),
              end: to.toISOString(),
            });
            return (
              <div key={item.id} style={{ display: "contents" }}>
                <div className="label">
                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                  <div className="muted small">
                    {areaOf(snapshot, item.workAreaId)?.name}
                  </div>
                </div>
                <div className="track">
                  {bar ? (
                    <div
                      className={"bar" + (item.committed ? "" : " draft")}
                      style={{
                        left: `${bar.left * 100}%`,
                        width: `${bar.width * 100}%`,
                      }}
                    >
                      {shortDate(item.start)} – {shortDate(item.end)}
                    </div>
                  ) : (
                    <span
                      className="muted small"
                      style={{ position: "absolute", left: 10, top: 20 }}
                    >
                      No dates yet
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}

// ── Sprints ──────────────────────────────────────────────────────────────────
export function Sprints({
  snapshot,
  now,
  model,
  onWork,
  onReview,
}: {
  snapshot: Snapshot;
  now: number;
  model: string | null;
  onWork(areaId: string, message?: string): void;
  onReview(planId: string, workAreaId: string | null): void;
}) {
  const [view, setView] = useState<(typeof sprintViews)[number][0]>("overview");
  const [areaId, setAreaId] = useState("");
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof sprintTabs)[number]>("Summary");
  const [note, setNote] = useState("");
  const areas = areasInScope(snapshot).filter(
    (area) => area.type === "product" || area.type === "project",
  );
  const allowed = new Set(areas.map((area) => area.id));
  const sprints = snapshot.sprints
    .filter(
      (sprint) =>
        allowed.has(sprint.workAreaId) &&
        (!areaId || sprint.workAreaId === areaId),
    )
    .map((sprint) => ({
      ...sprint,
      workAreaName: areaOf(snapshot, sprint.workAreaId)?.name ?? "",
    }));
  const current = sprints.find((sprint) => sprint.id === sprintId) ?? null;
  const draft =
    sprints.find(
      (sprint) => sprint.draft && (!areaId || sprint.workAreaId === areaId),
    ) ?? null;
  const active = snapshot.setup.activeGroupId;
  const tracker = snapshot.routes.find(
    (route) =>
      route.groupId === active &&
      (route.condition === "delivery" || route.condition === null),
  )?.tracker;
  const context = [
    groupName(snapshot, active),
    tracker ? trackerName(tracker) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const weekStart = new Date(
    now - ((new Date(now).getUTCDay() + 6) % 7) * dayMs,
  );
  weekStart.setUTCHours(0, 0, 0, 0);
  const range = {
    start: weekStart.toISOString(),
    end: new Date(weekStart.getTime() + 28 * dayMs).toISOString(),
  };
  const weeks = [0, 1, 2, 3].map((week) => {
    const from = new Date(weekStart.getTime() + week * 7 * dayMs);
    const to = new Date(from.getTime() + 6 * dayMs);
    return `${shortDate(from.toISOString())} – ${shortDate(to.toISOString())}`;
  });
  const exceptions = calendarNote(snapshot.calendar);
  const planSprint = async () => {
    if (!areaId) {
      setNote("Choose a work area first, then I’ll draft its next sprint.");
      return;
    }
    const last = sprints
      .filter((sprint) => sprint.workAreaId === areaId)
      .sort((a, b) => b.end.localeCompare(a.end))[0];
    const start = last ? Date.parse(last.end) + dayMs : now;
    const number = Number(/\d+/.exec(last?.name ?? "")?.[0] ?? 0) + 1;
    const result = await workAsync("save-sprint", {
      workAreaId: areaId,
      name: `Sprint ${number}`,
      team: last?.team ?? null,
      start: new Date(start).toISOString(),
      end: new Date(start + 13 * dayMs).toISOString(),
      draft: true,
    });
    if (result.ref) {
      setView("plan");
      setNote(
        "Drafted. Add stories by asking Firstmate, then approve to commit.",
      );
    } else setNote(result.message);
  };
  const footer = (
    <>
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
      <Composer
        placeholder="Ask Firstmate to plan or change a sprint…"
        chips={["/sprint plan", "Move story 124 to sprint 16"]}
        model={model}
        onSend={(text) => {
          if (/^\/sprint plan\b/.test(text)) return void planSprint();
          const target =
            areaId || current?.workAreaId || sprints[0]?.workAreaId;
          if (target) onWork(target, text);
          else setNote("Choose a work area first.");
        }}
      />
      <p className="muted small" style={{ marginTop: 8 }}>
        {outcomeNotes.preview}
      </p>
    </>
  );
  if (current) {
    const row = sprintRow(current, now);
    const steps = snapshot.activity.filter(
      (item) => item.workAreaId === current.workAreaId,
    );
    const history = [
      ...snapshot.plans.filter(
        (plan) => plan.workAreaId === current.workAreaId,
      ),
    ];
    return (
      <Page
        title={row.title}
        context={context}
        line={[
          current.team,
          `${shortDate(current.start)} – ${shortDate(current.end)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <button className="btn quiet" onClick={() => setSprintId(null)}>
              All sprints
            </button>
            <div className="rb-seg" role="tablist" aria-label="Sprint detail">
              {sprintTabs.map((name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={tab === name}
                  onClick={() => setTab(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </>
        }
        footer={footer}
      >
        {tab === "Summary" && (
          <div style={{ display: "grid", gap: 12, maxWidth: "68ch" }}>
            <p>{current.goal || "No sprint goal yet."}</p>
            <p className="row wrap">
              <span className="tag">{row.progress}</span>
              <span className="tag">{row.timing}</span>
              {row.flags.map((flag) => (
                <span key={flag} className="tag warn">
                  {flag}
                </span>
              ))}
            </p>
            {current.changedInAdo && (
              <p className="muted small">
                Someone changed this sprint in Azure DevOps. Amun shows the
                change and never reverts it.
              </p>
            )}
          </div>
        )}
        {tab === "Stories" &&
          (current.stories.length ? (
            <div className="rb-board">
              {[
                ...new Set(
                  current.stories.map((story) => story.owner ?? "Unassigned"),
                ),
              ].map((owner) => (
                <section className="rb-col" key={owner} aria-label={owner}>
                  <header>{owner}</header>
                  {current.stories
                    .filter((story) => (story.owner ?? "Unassigned") === owner)
                    .map((story) => (
                      <div className="rb-tile" key={story.id}>
                        <span className="name">{story.title}</span>
                        <span className="meta">
                          {story.points === null
                            ? "Not sized"
                            : `${story.points} points`}
                        </span>
                      </div>
                    ))}
                </section>
              ))}
            </div>
          ) : (
            <p className="muted">
              Stories appear here once the sprint has them. Board columns follow
              Azure DevOps after it is connected and the sprint is committed.
            </p>
          ))}
        {tab === "Pull requests" && (
          <p className="muted">
            Read-only. Open the work area and choose Backlog to see linked pull
            requests for this sprint.
          </p>
        )}
        {tab === "Activity" &&
          (steps.length ? (
            <div>
              {steps.slice(0, 40).map((step) => (
                <div className="rb-line" key={step.id}>
                  <span className={"dot " + step.state} aria-hidden="true" />
                  <span>{step.text}</span>
                  <span className="muted small">
                    {shortDate(step.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">
              Moves, additions and deployments for this sprint will appear here.
            </p>
          ))}
        {tab === "History" &&
          (history.length ? (
            <div>
              {history.map((plan) => (
                <div className="rb-line" key={plan.id}>
                  <Icon name="decisions" width={18} height={18} />
                  <span>{plan.summary}</span>
                  <span className="tag">{plan.state.replace("_", " ")}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">
              Approved and published plans for this work will be listed here.
            </p>
          ))}
      </Page>
    );
  }
  const summary = draft
    ? planSummary({
        goal: draft.goal,
        capacity: draft.capacity,
        stories: draft.stories,
        out: draft.out,
      })
    : null;
  return (
    <Page
      title="Sprints"
      context={context}
      line="Across your products, projects, and teams"
      actions={
        <>
          <Segmented<(typeof sprintViews)[number][0]>
            label="View"
            options={sprintViews}
            value={view}
            onChange={setView}
          />
          <WorkFilter areas={areas} value={areaId} onChange={setAreaId} />
        </>
      }
      footer={footer}
    >
      {view === "overview" && (
        <section aria-labelledby="rb-sprints-h">
          <h2 id="rb-sprints-h">Current and upcoming sprints</h2>
          <p className="muted small" style={{ margin: "4px 0 12px" }}>
            As of {shortDate(new Date(now).toISOString())} · Select a sprint to
            open it.
          </p>
          <div className="rb-rows">
            {sprintOverview(sprints, now, areaId || undefined).map((sprint) => {
              const row = sprintRow(sprint, now);
              return (
                <button
                  key={sprint.id}
                  className="rb-rowitem"
                  onClick={() => {
                    setSprintId(sprint.id);
                    setTab("Summary");
                  }}
                >
                  <span>
                    <span className="name">{row.title}</span>
                    <span className="muted small" style={{ display: "block" }}>
                      {[
                        sprint.team,
                        `${shortDate(sprint.start)} – ${shortDate(sprint.end)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="muted small" style={{ display: "block" }}>
                      {sprint.goal}
                    </span>
                  </span>
                  <span className="muted">{row.progress}</span>
                  <span>
                    <span className="muted small" style={{ display: "block" }}>
                      {row.timing}
                    </span>
                    {row.flags.map((flag) => (
                      <span
                        key={flag}
                        className="small"
                        style={{
                          display: "block",
                          color: "var(--amun-status-signed-out)",
                        }}
                      >
                        {flag}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          {!sprintOverview(sprints, now, areaId || undefined).length && (
            <p className="muted">
              No current or upcoming sprints. Ask Firstmate to plan one with
              /sprint plan.
            </p>
          )}
        </section>
      )}
      {view === "timeline" && (
        <section aria-labelledby="rb-timeline-h">
          <h2 id="rb-timeline-h">Sprint dates across teams</h2>
          <p className="muted small" style={{ margin: "4px 0 12px" }}>
            Solid = current or upcoming sprint · Outline = next draft
          </p>
          <div className="rb-timeline">
            <span />
            <div className="axis">
              {weeks.map((week) => (
                <span key={week}>{week}</span>
              ))}
            </div>
            {[...new Set(sprints.map((sprint) => sprint.workAreaId))].map(
              (id) => (
                <div key={id} style={{ display: "contents" }}>
                  <div className="label">
                    <div style={{ fontWeight: 600 }}>
                      {areaOf(snapshot, id)?.name}
                    </div>
                    <div className="muted small">
                      {sprints.find((sprint) => sprint.workAreaId === id)?.team}
                    </div>
                  </div>
                  <div className="track">
                    {sprints
                      .filter((sprint) => sprint.workAreaId === id)
                      .map((sprint) => {
                        const bar = timelineBar(sprint, range);
                        return (
                          bar && (
                            <button
                              key={sprint.id}
                              className={"bar" + (sprint.draft ? " draft" : "")}
                              style={{
                                left: `${bar.left * 100}%`,
                                width: `${bar.width * 100}%`,
                                justifyContent: "flex-start",
                              }}
                              onClick={() =>
                                sprint.draft
                                  ? setView("plan")
                                  : setSprintId(sprint.id)
                              }
                            >
                              {sprint.name}
                              {sprint.draft ? " draft" : ""}
                            </button>
                          )
                        );
                      })}
                  </div>
                </div>
              ),
            )}
          </div>
          {!sprints.length && (
            <p className="muted" style={{ marginTop: 12 }}>
              No sprints to show yet.
            </p>
          )}
          {exceptions ? (
            <p className="muted small" style={{ marginTop: 12 }}>
              {exceptions}
            </p>
          ) : (
            <p className="row wrap" style={{ marginTop: 12 }}>
              {snapshot.calendar.map((entry) => (
                <span key={entry.date} className="tag">
                  {shortDate(entry.date)} · {entry.label}
                </span>
              ))}
            </p>
          )}
        </section>
      )}
      {view === "plan" &&
        (draft && summary ? (
          <section
            aria-label="Proposed sprint"
            style={{ display: "grid", gap: 16 }}
          >
            <div className="row wrap">
              <h2 className="grow">
                {areaOf(snapshot, draft.workAreaId)?.name} · {draft.name}{" "}
                <span className="tag accent">Proposed</span>
              </h2>
              <button
                className="btn primary"
                disabled={!draft.stories.length}
                onClick={async () => {
                  const plan = await workAsync("propose-plan", {
                    groupId: null,
                    workAreaId: draft.workAreaId,
                    planKind: "sprint_plan",
                    destination: tracker ?? "ado",
                    summary: `${draft.name}: ${draft.stories.length} stories`,
                    items: draft.stories.map((story) => ({
                      id: story.id,
                      summary: story.title,
                      fields: {
                        sprint: draft.name,
                        owner: story.owner,
                        points: story.points,
                      },
                    })),
                  });
                  if (plan.ref) onReview(plan.ref, draft.workAreaId);
                }}
              >
                Review and approve
              </button>
            </div>
            <p>
              {draft.goal || <span className="muted">No sprint goal yet.</span>}
            </p>
            <div>
              <div className="row small" style={{ marginBottom: 6 }}>
                <span className="grow">Capacity</span>
                <span className={summary.capacity.known ? "" : "muted"}>
                  {summary.capacity.label}
                </span>
              </div>
              <div
                className={
                  "rb-capacity" +
                  (summary.capacity.known && summary.capacity.over
                    ? " over"
                    : "")
                }
              >
                <i
                  style={{
                    width: summary.capacity.known
                      ? `${Math.min(1, summary.capacity.ratio) * 100}%`
                      : 0,
                  }}
                />
              </div>
              {summary.unsized > 0 && (
                <p className="muted small" style={{ marginTop: 6 }}>
                  {summary.unsized}{" "}
                  {summary.unsized === 1 ? "story is" : "stories are"} not
                  sized.
                </p>
              )}
            </div>
            <div className="rb-board">
              {summary.byOwner.map((group) => (
                <section
                  className="rb-col"
                  key={group.owner}
                  aria-label={group.owner}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    work("move-sprint-story", {
                      sprintId: draft.id,
                      storyId: event.dataTransfer.getData("text/plain"),
                      list: "stories",
                      owner: group.owner === "Unassigned" ? null : group.owner,
                    });
                  }}
                >
                  <header>{group.owner}</header>
                  {group.stories.map((story) => (
                    <div
                      className="rb-tile"
                      key={story.id}
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/plain", story.id)
                      }
                    >
                      <span className="name">{story.title}</span>
                      <span className="meta">
                        {story.points === null
                          ? "Not sized"
                          : `${story.points} points`}
                      </span>
                    </div>
                  ))}
                </section>
              ))}
              <section
                className="rb-col"
                aria-label="Out of this sprint"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  work("move-sprint-story", {
                    sprintId: draft.id,
                    storyId: event.dataTransfer.getData("text/plain"),
                    list: "out",
                  });
                }}
              >
                <header>
                  Out
                  <span className="count">{draft.out.length}</span>
                </header>
                {draft.out.map((story) => (
                  <div
                    className="rb-tile"
                    key={story.id}
                    draggable
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/plain", story.id)
                    }
                  >
                    <span className="name">{story.title}</span>
                  </div>
                ))}
              </section>
            </div>
          </section>
        ) : (
          <p className="muted">
            No draft sprint yet. Choose a work area and send /sprint plan to
            propose the next one.
          </p>
        ))}
    </Page>
  );
}

// ── Portfolio ────────────────────────────────────────────────────────────────
export function Portfolio({
  snapshot,
  onWork,
}: {
  snapshot: Snapshot;
  onWork(areaId: string): void;
}) {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [group, setGroup] = useState("");
  const all = areasInScope(snapshot);
  const areas = all.filter(
    (area) =>
      (!type || area.type === type) &&
      (!status || area.status === status) &&
      (!group || area.groupId === group),
  );
  const statuses = [...new Set(all.map((area) => area.status))];
  return (
    <Page
      title="Portfolio"
      line="Every product, project, task and RFP. Open one to continue its conversation."
      actions={
        <>
          {!snapshot.setup.activeGroupId && snapshot.groups.length > 1 && (
            <label className="row muted small">
              Group
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option value="">All groups</option>
                {snapshot.groups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="row muted small">
            Type
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="">All types</option>
              {Object.entries(typeLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="row muted small">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">Any status</option>
              {statuses.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      {areas.length ? (
        <div className="rb-work">
          {areas.map((area) => {
            const waiting = snapshot.attention.filter(
              (item) => item.workAreaId === area.id && item.state === "open",
            ).length;
            return (
              <button
                key={area.id}
                className="rb-workcard"
                onClick={() => onWork(area.id)}
              >
                <span className="row">
                  <span className="name grow">{area.name}</span>
                  {waiting > 0 && <span className="count">{waiting}</span>}
                </span>
                <span className="meta">
                  {[
                    typeLabels[area.type],
                    groupName(snapshot, area.groupId) ?? "No group yet",
                    area.status,
                  ].join(" · ")}
                </span>
                {area.purpose && <span className="meta">{area.purpose}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">
          {all.length
            ? "Nothing matches these filters."
            : "Work you start from Home appears here."}
        </p>
      )}
    </Page>
  );
}

/** The two facts a handoff waits for. Ticks respond at once, then persist. */
function Readiness({
  signed,
  approved,
  onChange,
}: {
  signed: boolean;
  approved: boolean;
  onChange(signed: boolean, approved: boolean): void;
}) {
  const [value, setValue] = useState({ signed, approved });
  const set = (next: { signed: boolean; approved: boolean }) => {
    setValue(next);
    onChange(next.signed, next.approved);
  };
  return (
    <>
      <label className="row">
        <input
          type="checkbox"
          checked={value.signed}
          onChange={(event) => set({ ...value, signed: event.target.checked })}
        />
        Proposal signed
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={value.approved}
          onChange={(event) =>
            set({ ...value, approved: event.target.checked })
          }
        />
        BRD approved
      </label>
    </>
  );
}

// ── RFPs ─────────────────────────────────────────────────────────────────────
export function Rfps({
  snapshot,
  now,
  model,
  onWork,
}: {
  snapshot: Snapshot;
  now: number;
  model: string | null;
  onWork(areaId: string): void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const allowed = new Set(areasInScope(snapshot).map((area) => area.id));
  const rfps = snapshot.rfps.filter((rfp) => allowed.has(rfp.id));
  const current = rfps.find((rfp) => rfp.id === selected) ?? null;
  const name = (id: string) => areaOf(snapshot, id)?.name ?? "RFP";
  const move = async (id: string, stage: RfpStage) => {
    if (stage === "handed_to_delivery") {
      const result = await workAsync("handoff-rfp", { areaId: id });
      setNote(
        result.ok ? "Handed to delivery. The RFP is kept." : result.message,
      );
      return;
    }
    const result = await workAsync("move-rfp", { areaId: id, stage });
    setNote(result.ok ? "" : result.message);
  };
  const card = (rfp: (typeof rfps)[number]) => {
    const view = rfpCard(rfp, now);
    return (
      <button
        key={rfp.id}
        className="rb-tile"
        draggable
        aria-pressed={selected === rfp.id}
        onDragStart={(event) =>
          event.dataTransfer.setData("text/plain", rfp.id)
        }
        onClick={() => setSelected(selected === rfp.id ? null : rfp.id)}
        style={{ justifyContent: "stretch" }}
      >
        <span className="name">{name(rfp.id)}</span>
        <span className="meta">{rfp.client || "Client not set"}</span>
        <span className="row wrap">
          {view.countdown && (
            <span className={"tag " + (view.atRisk ? "bad" : "")}>
              {view.countdown}
            </span>
          )}
          {view.missingOwner && (
            <span className="tag warn">No response owner</span>
          )}
          {view.subline && <span className="tag">{view.subline}</span>}
        </span>
      </button>
    );
  };
  const handoff = current ? rfpHandoff(current) : null;
  const field = (
    label: string,
    key: "responseOwner" | "accountOwner" | "presales" | "client",
  ) =>
    current && (
      <label className="field">
        {label}
        <input
          type="text"
          defaultValue={current[key] ?? ""}
          key={current.id + key}
          maxLength={200}
          onBlur={(event) =>
            work("save-rfp", {
              areaId: current.id,
              groupId: null,
              name: name(current.id),
              client: current.client,
              deadline: current.deadline,
              responseOwner: current.responseOwner,
              accountOwner: current.accountOwner,
              presales: current.presales,
              [key]:
                event.target.value.trim() || (key === "client" ? "" : null),
            })
          }
        />
      </label>
    );
  return (
    <Page
      title="RFPs"
      line={rfpAuthoringBoundary}
      footer={
        <>
          {note && (
            <p className="muted small" role="status">
              {note}
            </p>
          )}
          <Composer
            placeholder="Track an RFP, e.g. Smart Inspection for DMT, due 17 November"
            chips={["Track an RFP"]}
            model={model}
            onSend={async (text) => {
              const title = text.replace(/^track an rfp:?\s*/i, "").trim();
              if (!title) return setNote("Name the RFP you want to track.");
              const due = /\bdue\s+(.+)$/i.exec(title);
              const parsed = due
                ? Date.parse(due[1]! + " " + new Date(now).getFullYear())
                : NaN;
              const named =
                title.replace(/,?\s*\bdue\s+.+$/i, "").trim() || title;
              const client = /\b(?:for|from)\s+(.+)$/i.exec(named)?.[1] ?? "";
              const result = await workAsync("save-rfp", {
                groupId: snapshot.setup.activeGroupId,
                client,
                name: named,
                deadline: Number.isNaN(parsed)
                  ? null
                  : new Date(parsed).toISOString(),
              });
              setNote(result.ok ? "" : result.message);
              if (result.ref) setSelected(result.ref);
            }}
          />
        </>
      }
    >
      <div className="rb-board">
        {rfpStages.map((stage) => (
          <section
            key={stage}
            className={"rb-col" + (over === stage ? " over" : "")}
            aria-label={rfpStageLabels[stage]}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(stage);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              void move(event.dataTransfer.getData("text/plain"), stage);
            }}
          >
            <header>
              {rfpStageLabels[stage]}
              <span className="count">
                {rfps.filter((rfp) => rfp.stage === stage).length}
              </span>
            </header>
            {rfps.filter((rfp) => rfp.stage === stage).map(card)}
          </section>
        ))}
      </div>
      {!rfps.length && (
        <p className="muted">
          No RFPs are being tracked. Tell Firstmate about one below.
        </p>
      )}
      <button
        className="link small"
        style={{ justifySelf: "start", marginTop: 12 }}
        aria-expanded={closed}
        onClick={() => setClosed(!closed)}
      >
        Lost and withdrawn (
        {
          rfps.filter((rfp) =>
            (rfpClosed as readonly string[]).includes(rfp.stage),
          ).length
        }
        )
      </button>
      {closed && (
        <div className="rb-work" style={{ marginTop: 8 }}>
          {rfps
            .filter((rfp) =>
              (rfpClosed as readonly string[]).includes(rfp.stage),
            )
            .map(card)}
        </div>
      )}
      {current && (
        <section
          className="rb-panel"
          aria-label={name(current.id)}
          style={{ marginTop: 20 }}
        >
          <header>
            <h2>{name(current.id)}</h2>
            <span className="tag">{rfpStageLabels[current.stage]}</span>
            <span className="grow" />
            <button className="btn" onClick={() => onWork(current.id)}>
              Open conversation
            </button>
          </header>
          <div style={{ padding: "0 18px 18px", display: "grid", gap: 14 }}>
            <div className="rb-route">
              {field("Client", "client")}
              <label className="field">
                Response deadline
                <input
                  type="date"
                  key={current.id + "deadline"}
                  defaultValue={current.deadline?.slice(0, 10) ?? ""}
                  onChange={(event) =>
                    work("save-rfp", {
                      areaId: current.id,
                      groupId: null,
                      name: name(current.id),
                      client: current.client,
                      responseOwner: current.responseOwner,
                      accountOwner: current.accountOwner,
                      presales: current.presales,
                      deadline: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                    })
                  }
                />
              </label>
              {field("Response owner", "responseOwner")}
              {field("Sales or account owner", "accountOwner")}
              {field("Pre-sales contact", "presales")}
              <label className="field">
                Stage
                <select
                  value={current.stage}
                  onChange={(event) =>
                    move(current.id, event.target.value as RfpStage)
                  }
                >
                  {[...rfpStages, ...rfpClosed].map((stage) => (
                    <option
                      key={stage}
                      value={stage}
                      disabled={
                        stage === "handed_to_delivery" &&
                        !current.deliveryProjectId
                      }
                    >
                      {rfpStageLabels[stage]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {current.stage === "lost" && (
              <label className="field">
                Loss reason, if known
                <input
                  type="text"
                  key={current.id + "loss"}
                  defaultValue={current.lossReason ?? ""}
                  maxLength={400}
                  onBlur={(event) =>
                    work("move-rfp", {
                      areaId: current.id,
                      stage: "lost",
                      lossReason: event.target.value.trim() || null,
                    })
                  }
                />
              </label>
            )}
            {(current.stage === "won" ||
              current.stage === "handed_to_delivery") && (
              <div style={{ display: "grid", gap: 8 }}>
                <Readiness
                  key={current.id}
                  signed={current.proposalSigned}
                  approved={current.brdApproved}
                  onChange={(proposalSigned, brdApproved) =>
                    work("rfp-readiness", {
                      areaId: current.id,
                      proposalSigned,
                      brdApproved,
                    })
                  }
                />
                <div className="row">
                  {handoff?.step === "reuse" ? (
                    <button
                      className="btn"
                      onClick={() => onWork(handoff.projectId)}
                    >
                      Open delivery project
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      disabled={handoff?.step !== "create"}
                      onClick={() => move(current.id, "handed_to_delivery")}
                    >
                      Hand to delivery
                    </button>
                  )}
                  {handoff?.step === "wait" && (
                    <span className="muted small">
                      {handoff.pending === "signature"
                        ? "Waiting for the signed proposal."
                        : "Waiting for the approved BRD."}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </Page>
  );
}
