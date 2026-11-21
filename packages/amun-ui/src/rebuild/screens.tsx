import {
  ProjectFilter,
  useProjectFilter,
  matchesProjectTag,
} from "./project-backlog-filter.tsx";
import { readPlanningCache } from "./planning-cache.ts";
import { SprintBlockers } from "./sprint-blockers.tsx";
import { ResumePlanning, OfflinePlanning } from "./resume-planning.tsx";
import type { SavedPlanningLink } from "./planning-draft.ts";
import { useSprintOverview } from "./sprint-azure.ts";
// The six sidebar destinations (handoff §9): Agents · Council · Roadmap ·
// Sprints · Portfolio · RFPs. Each is driven by the composer plus a few
// direct manipulations; committing anything goes through an approval.
import { SprintPlanner } from "./sprint-planner.tsx";
import { browserStore, readBoard } from "../backlog-selection.ts";
import { inspectView } from "../daemon/navigation.ts";
import { AVATARS, chooseAvatar, useChosenAvatar } from "./avatar-choice.ts";
import {
  agentCatalog,
  agentProfile,
} from "../../../../packages/domain/src/work/agents.ts";
import {
  blockerLine,
  openBlockers,
} from "../../../../packages/domain/src/work/blockers.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import {
  Fragment,
  useEffect,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  horizonBoard,
  planSummary,
  calendarNote,
  releaseGroups,
  riceBadge,
  roadmapViews,
  adoSprints,
  sprintGroups,
  sprintCommand,
  sprintRow,
  sprintTabs,
  sprintViews,
  timelineBar,
  type Sprint,
  type Horizon,
} from "../../../../packages/domain/src/work/planning.ts";
import {
  objectiveLine,
  trackerName,
} from "../../../../packages/domain/src/work/flows.ts";
import {
  parseCouncilCommand,
  simulationLabel,
  suggestFullCouncil,
} from "../../../../packages/domain/src/work/council.ts";
import { outcomeNotes } from "../../../../packages/domain/src/work/home.ts";
import { portfolioOrder } from "../../../../packages/domain/src/work/portfolio.ts";
import { ProgressCard, WorkSheet } from "./work-cards.tsx";
import { FirstmateMark } from "./firstmate-mark.tsx";
import { Icon } from "../icons.tsx";
import { AgentWatch } from "./agent-watch.tsx";
import { Composer } from "./composer.tsx";
import { sprintReplies, useAzureSprints } from "./sprint-azure.ts";
import { holdSprintContext, sprintContextText } from "./sprint-context.ts";
import { BrowserPane } from "./work-session.tsx";
import { MarkdownMessage } from "./markdown-doc.tsx";
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
  fixed,
  wide,
}: {
  title: string;
  context?: string;
  line?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Keeps the page still so panes inside it scroll on their own. */
  fixed?: boolean;
  /** Room for card grids on a desktop window. */
  wide?: boolean;
}) {
  return (
    <div className={fixed ? "rb-scroll fixed" : "rb-scroll"}>
      <div className={wide ? "rb-page wide" : "rb-page"}>
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
type AgentRow = Snapshot["agents"][number];
const catalogId = "catalog:";
const absent = (agent: AgentRow) => agent.id.startsWith(catalogId);
const live = (agent: AgentRow) =>
  agent.state === "working" || agent.state === "waiting";
function SpecialistCard({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentRow;
  selected: boolean;
  onSelect(id: string): void;
}) {
  const profile = agentProfile(agent.role);
  const line = profile?.tags?.length
    ? profile.tags.join(" · ")
    : (profile?.summary ?? agent.nowDoing ?? "");
  return (
    <button
      className={
        "rb-spec" +
        (agent.enabled ? "" : " off") +
        (agent.state === "working"
          ? " working"
          : agent.state === "waiting"
            ? " blocked"
            : "")
      }
      aria-pressed={selected}
      onClick={() => onSelect(agent.id)}
    >
      <AgentAvatar role={agent.role} size={44} />
      <span className="text">
        <strong title={agent.role}>
          <span>{agent.role}</span>
          {agent.state === "working" && (
            <span className="rb-badge working">Working</span>
          )}
          {agent.state === "waiting" && (
            <span className="rb-badge blocked">Blocked</span>
          )}
        </strong>
        {line && <span title={line}>{line}</span>}
      </span>
    </button>
  );
}
function SpecialistPanel({
  agent,
  position,
  total,
  onLink,
  onAdded,
  onAsk,
}: {
  agent: AgentRow;
  position: number;
  total: number;
  onLink?(url: string): void;
  onAdded?(id: string): void;
  onAsk?(text: string): void;
}) {
  const [watch, setWatch] = useState(false);
  const profile = agentProfile(agent.role);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    <section className="rb-spec-panel" aria-label={agent.role}>
      <header>
        <AgentAvatar role={agent.role} size={80} />
        <div>
          <p
            className="kicker"
            title={`Specialist ${pad(position)} of ${pad(total)} · Dispatched by Firstmate`}
          >
            Specialist {pad(position)} of {pad(total)} · Dispatched by Firstmate
          </p>
          <h2>{agent.role}</h2>
          <p className="summary">
            {profile
              ? profile.summary
              : agent.kind === "temporary"
                ? "One of Firstmate’s crew"
                : "Added by you"}
          </p>
        </div>
      </header>
      {profile && (
        <>
          <section className="block">
            <h3>What this specialist owns for you</h3>
            <p>{profile.scope}</p>
          </section>
          <section className="block">
            <h3>Deliverables it brings back to your chat</h3>
            <p>{profile.outputs}</p>
          </section>
          <section className="block">
            <h3>Built-in industry frameworks &amp; templates</h3>
            <ul className="chips">
              {profile.frameworks.map(([name, link]) => (
                <li key={name}>
                  {onLink ? (
                    <a
                      href={link}
                      onClick={(event) => {
                        event.preventDefault();
                        onLink(link);
                      }}
                    >
                      {name}
                    </a>
                  ) : (
                    <span>{name}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <AgentControls
        agent={agent}
        watch={watch}
        onWatch={setWatch}
        onLink={onLink}
        onAdded={onAdded}
        onAsk={onAsk}
      />
    </section>
  );
}
/** A new agent from scratch: Firstmate provisions it; Amun keeps its card. */
function CreateAgent({
  onCancel,
  onCreated,
}: {
  onCancel(): void;
  onCreated(id: string | null): void;
}) {
  const [name, setName] = useState("");
  const [what, setWhat] = useState("");
  const [problem, setProblem] = useState("");
  return (
    <section className="rb-spec-panel" aria-label="Create Agent">
      <header>
        <div>
          <p className="kicker">New specialist · Provisioned by Firstmate</p>
          <h2>Create Agent</h2>
          <p className="summary">
            Name it and say what it should own. Firstmate briefs and starts it;
            its card joins your pool so you can add it again later.
          </p>
        </div>
      </header>
      <form
        className="rb-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void workAsync("add-agent", {
            description: what.trim()
              ? `${name.trim()}: ${what.trim()}`
              : name.trim(),
          }).then((result) => {
            if (!result.ok) return setProblem(result.message);
            onCreated(result.ref ?? null);
          });
        }}
      >
        <label className="field">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Pricing Analyst"
            required
          />
        </label>
        <label className="field">
          What it owns for you
          <textarea
            rows={4}
            value={what}
            onChange={(event) => setWhat(event.target.value)}
            placeholder="e.g. reads competitor pricing pages weekly and flags changes"
          />
        </label>
        {problem && (
          <p className="rb-notice error" role="alert">
            {problem}
          </p>
        )}
        <div className="row wrap">
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            Create Agent
          </button>
          <button className="btn quiet" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
/**
 * Edit and retire go to the First Mate, which changes its secondmates its own
 * way. The picture is Amun's and changes here at once.
 */
function TeamActions({
  agent,
  editable,
}: {
  agent: AgentRow;
  editable: boolean;
}) {
  const [mode, setMode] = useState<"none" | "edit" | "retire">("none");
  const [change, setChange] = useState("");
  const [note, setNote] = useState("");
  const avatar = useChosenAvatar(agent.role);
  return (
    <div className="rb-team-actions">
      {mode === "none" && (
        <div className="row wrap">
          <button className="btn" onClick={() => setMode("edit")}>
            Edit Agent
          </button>
          <button className="btn quiet" onClick={() => setMode("retire")}>
            Retire Agent
          </button>
        </div>
      )}
      {mode === "edit" && (
        <form
          className="rb-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (editable && change.trim())
              void workAsync("edit-agent", {
                agentId: agent.id,
                change: change.trim(),
              }).then((result) =>
                setNote(result.ok ? "Sent to Firstmate." : result.message),
              );
            setChange("");
            setMode("none");
          }}
        >
          <fieldset className="rb-avatar-pick">
            <legend>Picture</legend>
            {AVATARS.map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={avatar === name}
                onClick={() => chooseAvatar(agent.role, name)}
              >
                <img
                  src={`./avatars/${name}.webp`}
                  alt=""
                  width={36}
                  height={36}
                />
              </button>
            ))}
          </fieldset>
          {editable && (
            <label className="field">
              What should change? Firstmate updates its brief.
              <textarea
                rows={3}
                value={change}
                onChange={(event) => setChange(event.target.value)}
                placeholder="e.g. focus on enterprise buyers and cite sources"
              />
            </label>
          )}
          <div className="row wrap">
            <button className="btn primary" type="submit">
              {editable && change.trim() ? "Send to Firstmate" : "Done"}
            </button>
            <button
              className="btn quiet"
              type="button"
              onClick={() => setMode("none")}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {mode === "retire" && (
        <div className="rb-inline amber" role="group" aria-label="Retire agent">
          <strong>Retire {agent.role}?</strong>
          <span>
            Firstmate saves its open work and notes first, then retires it. Its
            card goes back to the pool, ready to add again.
          </span>
          <div className="row wrap">
            <button
              className="btn primary"
              onClick={() => {
                work("toggle-agent", { agentId: agent.id, enabled: false });
                setMode("none");
                setNote("Asked Firstmate to save its work and retire it.");
              }}
            >
              Retire Agent
            </button>
            <button className="btn quiet" onClick={() => setMode("none")}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
function AgentControls({
  agent,
  watch,
  onWatch,
  onLink,
  onAdded,
  onAsk,
}: {
  agent: AgentRow;
  watch: boolean;
  onWatch(value: boolean): void;
  onLink?: ((url: string) => void) | undefined;
  onAdded?: ((id: string) => void) | undefined;
  /** Sends Firstmate a message about this agent. */
  onAsk?: ((text: string) => void) | undefined;
}) {
  const member = agent.kind !== "lead";
  const notCreated = absent(agent);
  return (
    <div className="controls">
      <div className="row wrap">
        <p>
          <span className="muted">Now doing · </span>
          {agent.nowDoing ?? "Nothing right now"}
        </p>
        <span className="grow" />
        {member && !agent.enabled && (
          <span className="muted small">Not on your team</span>
        )}
        {!notCreated && (
          <button
            className="btn"
            aria-pressed={watch}
            onClick={() => onWatch(!watch)}
          >
            Watch
          </button>
        )}
        {member && !agent.enabled && (
          <button
            className="btn"
            onClick={() => {
              if (notCreated) {
                void workAsync("add-agent", { description: agent.role }).then(
                  (result) => {
                    if (result.ok && result.ref) onAdded?.(result.ref);
                  },
                );
                return;
              }
              work("toggle-agent", { agentId: agent.id, enabled: true });
            }}
          >
            Add to team
          </button>
        )}
      </div>
      {member && agent.enabled && (
        <TeamActions agent={agent} editable={!notCreated} />
      )}
      {agent.state === "waiting" && member && onAsk && (
        <div className="rb-inline amber" role="group" aria-label="Blocked">
          <span>
            {agent.role} is blocked and waiting. Firstmate can look at it and
            unblock it, or tell you what it needs from you.
          </span>
          <div className="row wrap">
            <button
              className="btn"
              onClick={() =>
                onAsk(
                  `${agent.role} is blocked. Look at its window, tell me in one line what it is waiting for, and unblock it if you can. If it needs my choice, ask me with the options.`,
                )
              }
            >
              Ask Firstmate to unblock it
            </button>
          </div>
        </div>
      )}
      <AgentOutput output={agent.output} {...(onLink && { onLink })} />
      {watch && (
        <AgentWatch
          agentId={agent.id}
          launcherId={agent.launcherId}
          name={agent.role}
        />
      )}
    </div>
  );
}
/** What an agent has produced for its current task, formatted like the chat. */
export function AgentOutput({
  output,
  onLink,
}: {
  output: string;
  onLink?(url: string): void;
}) {
  return (
    <div>
      <span className="muted">Output so far</span>
      {output ? (
        <MarkdownMessage text={output} {...(onLink && { onLink })} />
      ) : (
        <p>No output yet</p>
      )}
    </div>
  );
}
export function Agents({
  snapshot,
  model,
  onLink,
  onAsk,
  initialAgent = null,
}: {
  snapshot: Snapshot;
  model: string | null;
  /** Sends Firstmate a message, opening the conversation it lands in. */
  onAsk?(text: string): void;
  /** The agent to open first, e.g. from its avatar in the right rail. */
  initialAgent?: string | null;
  /** Opens a link from an agent's output; without it links stay plain text. */
  onLink?(url: string): void;
}) {
  const [selected, setSelected] = useState<string | null>(initialAgent);
  const [problem, setProblem] = useState("");
  const [creating, setCreating] = useState(false);
  const lead = snapshot.agents.find((item) => item.kind === "lead");
  const members = snapshot.agents.filter((item) => item.kind !== "lead");
  // Every catalog specialist in catalog order (a placeholder when it is not in
  // the workspace yet), then the agents the owner added themselves.
  const everyone: AgentRow[] = [
    ...agentCatalog.map(
      (profile): AgentRow =>
        members.find(
          (item) => item.role.toLowerCase() === profile.name.toLowerCase(),
        ) ?? {
          id: catalogId + profile.name,
          role: profile.name,
          kind: "always_on",
          launcherId: null,
          state: "idle",
          nowDoing: null,
          output: "",
          enabled: false,
        },
    ),
    ...members.filter(
      (item) =>
        !agentCatalog.some(
          (profile) => profile.name.toLowerCase() === item.role.toLowerCase(),
        ),
    ),
  ];
  // Anyone blocked comes first, so a problem is on screen without scrolling;
  // then whoever is working; the rest keep their order.
  const urgency = (item: AgentRow) =>
    item.state === "waiting" ? 0 : item.state === "working" ? 1 : 2;
  const specialists = everyone
    .map((item, index) => ({ item, index }))
    .sort((a, b) => urgency(a.item) - urgency(b.item) || a.index - b.index)
    .map(({ item }) => item);
  const chosen =
    (selected && specialists.find((item) => item.id === selected)) ||
    (selected && snapshot.agents.find((item) => item.id === selected)) ||
    specialists.find((item) => item.state === "waiting") ||
    specialists.find((item) => item.role === "Product Manager") ||
    specialists[0] ||
    lead;
  const onTeam = specialists.filter((item) => item.enabled).length;
  return (
    <Page
      title="Agents"
      fixed
      actions={
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" width={16} height={16} />
          Create Agent
        </button>
      }
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
      {lead ? (
        <div className="rb-agents">
          <div className="list">
            <button
              className="rb-lead-card"
              aria-pressed={chosen?.id === lead.id}
              onClick={() => setSelected(lead.id)}
            >
              <FirstmateMark
                size={44}
                mood={specialists.some(live) ? "working" : "resting"}
              />
              <span className="text">
                <strong>Firstmate</strong>
                <span>
                  Your AI product team leader · You talk only to Firstmate
                </span>
              </span>
              <span className="pill">Lead Agent</span>
            </button>
            <div className="count-row">
              <span>
                {specialists.length} day-one specialists (click any agent to
                inspect)
              </span>
              <span>
                {onTeam} of {specialists.length} selected
              </span>
            </div>
            <div className="grid">
              {specialists.map((item) => (
                <SpecialistCard
                  key={item.id}
                  agent={item}
                  selected={chosen?.id === item.id}
                  onSelect={setSelected}
                />
              ))}
            </div>
          </div>
          {creating ? (
            <CreateAgent
              onCancel={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                if (id) setSelected(id);
              }}
            />
          ) : (
            chosen &&
            (chosen.kind === "lead" ? (
              <section
                key={chosen.id}
                className="rb-spec-panel"
                aria-label="Firstmate"
              >
                <header>
                  <FirstmateMark
                    size={88}
                    mood={specialists.some(live) ? "working" : "resting"}
                  />
                  <div>
                    <p className="kicker">Lead agent</p>
                    <h2>Firstmate</h2>
                    <p className="summary">
                      Your AI product team leader. You talk only to Firstmate;
                      it hands the work to your specialists and brings back the
                      results.
                    </p>
                  </div>
                </header>
                <LeadControls agent={chosen} {...(onLink && { onLink })} />
              </section>
            ) : (
              <SpecialistPanel
                key={chosen.id}
                agent={chosen}
                position={
                  specialists.findIndex((item) => item.id === chosen.id) + 1
                }
                total={specialists.length}
                onAdded={setSelected}
                {...(onLink && { onLink })}
                {...(onAsk && { onAsk })}
              />
            ))
          )}
        </div>
      ) : (
        <p className="muted">Finish setup to meet Firstmate and your agents.</p>
      )}
    </Page>
  );
}
function LeadControls({
  agent,
  onLink,
}: {
  agent: AgentRow;
  onLink?: (url: string) => void;
}) {
  const [watch, setWatch] = useState(false);
  return (
    <AgentControls
      agent={agent}
      watch={watch}
      onWatch={setWatch}
      onLink={onLink}
    />
  );
}

// ── Council ──────────────────────────────────────────────────────────────────
import type { CouncilStatus } from "../../../../packages/contracts/src/work.ts";
/** The Roast Room is laid out for a wide window: two columns from 1221 px,
    and a table at least 520 px tall under its header. */
const roomDesign = { width: 1280, height: 770 };
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
      // With the room open, the room itself says what this is; the space
      // goes to the advisors.
      {...(!status?.roomUrl && {
        line: "Put a hard decision to a board of advisors. They debate; you decide.",
      })}
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
      {status && status.seats.length > 0 && !status.roomUrl && (
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
        <section aria-label="The room" className="rb-panel rb-room">
          <BrowserPane url={status.roomUrl} hidden={false} fit={roomDesign} />
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
            onChange={(choice) => {
              inspectView({ view: choice, source: "Sprints" });
              setView(choice);
            }}
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
/** Sprint dates by work area. Every bar sits inside its own area's row. */
export function SprintTimeline({
  snapshot,
  sprints,
  range,
  weeks,
  onOpen,
}: {
  snapshot: Snapshot;
  sprints: (Sprint & { draft: boolean })[];
  range: { start: string; end: string };
  weeks: string[];
  onOpen(sprint: Sprint): void;
}) {
  return (
    <div className="rb-timeline">
      <span />
      <div className="axis">
        {weeks.map((week) => (
          <span key={week}>{week}</span>
        ))}
      </div>
      {[...new Set(sprints.map((sprint) => sprint.workAreaId))].map((id) => (
        <Fragment key={id}>
          <div className="label">
            <div style={{ fontWeight: 600 }}>{areaOf(snapshot, id)?.name}</div>
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
                      key={JSON.stringify([sprint.workAreaId, sprint.id])}
                      className={"bar" + (sprint.draft ? " draft" : "")}
                      style={{
                        left: `${bar.left * 100}%`,
                        width: `${bar.width * 100}%`,
                        justifyContent: "flex-start",
                      }}
                      onClick={() => onOpen(sprint)}
                    >
                      {sprint.name}
                      {sprint.draft ? " draft" : ""}
                    </button>
                  )
                );
              })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export function Sprints({
  snapshot,
  now,
  model,
  onWork,
  onReview,
  resume,
}: {
  resume?: SavedPlanningLink | null;
  snapshot: Snapshot;
  now: number;
  model: string | null;
  onWork(
    areaId: string,
    message?: string,
    chatId?: string,
    messageId?: string,
  ): void;
  onReview(planId: string, workAreaId: string | null): void;
}) {
  const [view, setView] = useState<(typeof sprintViews)[number][0]>("overview");
  const [areaId, setAreaId] = useState(resume?.areaId ?? "");
  const [savedLink, setSavedLink] = useState(resume);
  const [selection, selectSprint] = useState<Pick<
    Sprint,
    "id" | "workAreaId"
  > | null>(
    resume ? { id: "ado:" + resume.sprintId, workAreaId: resume.areaId } : null,
  );
  const [tab, setTab] = useState<(typeof sprintTabs)[number]>(
    resume ? "Planning" : "Summary",
  );
  const [note, setNote] = useState("");
  function openPlanningChat(workAreaId: string, chat: string, ref?: string) {
    const request = ref && snapshot.requests?.find((r) => r.ref === ref);
    const message =
      request &&
      snapshot.chats
        .find((c) => c.id === chat && c.workAreaId === workAreaId)
        ?.messages.find((m) => m.id === request.messageId);
    if (ref && !message) {
      setNote("The original request is unavailable. Refresh its receipt.");
      return;
    }
    onWork(workAreaId, undefined, chat, message ? message.id : undefined);
  }
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
  const azure = useAzureSprints(
    areas,
    selection?.workAreaId ?? areaId,
    setNote,
  );
  const boundAreas = areas.filter(
    (area) =>
      area.productId === azure.productId && (!areaId || area.id === areaId),
  );
  const azureArea = boundAreas.length === 1 ? boundAreas[0] : undefined;
  const additional = useSprintOverview(areas, areaId, azure.productId);
  const fromAzure = areas.flatMap((area) => {
    if (areaId && area.id !== areaId) return [];
    const reply = boundAreas.some((bound) => bound.id === area.id)
      ? azure.reply
      : additional[area.id];
    return reply
      ? adoSprints(reply.sprints, reply.team.name, area.id, area.name).map(
          (sprint) => {
            const read =
              selection?.workAreaId === area.id &&
              azure.items?.state === "ready" &&
              sprint.id === `ado:${azure.items.sprint}`
                ? azure.items.items
                : [];
            return {
              ...sprint,
              done: read.filter((item) =>
                /^(done|closed|completed)$/i.test(item.state),
              ).length,
              total: read.length,
              stories: read.map((item) => ({
                id: String(item.id),
                title: `#${item.id} ${item.title}`,
                indicator: item.indicator,
                points: item.points ?? null,
                owner: item.assignee,
              })),
              out: [],
              capacity: null,
            };
          },
        )
      : [];
  });
  const overview = [...sprints, ...fromAzure];
  const groups = sprintGroups(overview, now);
  const current =
    overview.find(
      (sprint) =>
        sprint.id === selection?.id &&
        sprint.workAreaId === selection.workAreaId,
    ) ?? null;
  const azureDetail = new Map(
    (azure.items?.state === "ready" ? azure.items.items : []).map((item) => [
      String(item.id),
      item,
    ]),
  );
  const openAzure = current?.id.startsWith("ado:")
    ? current.id.slice("ado:".length)
    : null;
  const filterBoard =
    azure.sourceId &&
    readBoard(browserStore(), azure.productId, azure.sourceId);
  const sprintFilter = useProjectFilter({
    productId: azure.productId,
    sourceId: azure.sourceId,
    team: azure.reply?.team.id ?? "",
    backlog: filterBoard ? filterBoard.level : "",
  });
  const openSprint = azure.openSprint;
  // Opening an Azure sprint reads its work items (read-only).
  useEffect(() => {
    if (openAzure && azure.reply) openSprint(openAzure);
  }, [openAzure, azure.reply, selection?.workAreaId]);
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
  const discussSprint = async (message?: string) => {
    if (!current) return;
    const result = await workAsync("new-chat", {
      workAreaId: current.workAreaId,
      sprint: {
        connection: openAzure
          ? (azure.reply?.sourceId ?? azure.sourceId)
          : "amun",
        id: current.id,
        name: current.name,
      },
    });
    if (result.ok && result.ref)
      onWork(current.workAreaId, message, result.ref);
    else setNote(result.message);
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
          const command = sprintCommand(text);
          if (command?.kind === "plan") return void planSprint();
          if (command) return azure.run(command);
          const target =
            areaId ||
            current?.workAreaId ||
            sprints[0]?.workAreaId ||
            azureArea?.id;
          if (target && azure.reply && target === azureArea?.id) {
            const path = azure.reply.sprints.find(
              (item) => `ado:${item.id}` === current?.id,
            );
            holdSprintContext(
              target,
              sprintContextText({
                team: azure.reply.team.name,
                sprints: azure.reply.sprints,
                open:
                  path && azure.items?.state === "ready"
                    ? {
                        name: path.name,
                        path: path.path,
                        items: azure.items.items,
                      }
                    : null,
              }),
            );
          }
          if (current) void discussSprint(text);
          else if (target) onWork(target, text);
          else setNote("Choose a work area first.");
        }}
      />
      <p className="muted small" style={{ marginTop: 8 }}>
        {outcomeNotes.preview}
      </p>
    </>
  );
  const selectedDraft =
    savedLink &&
    allowed.has(savedLink.areaId) &&
    selection?.workAreaId === savedLink.areaId &&
    selection.id === "ado:" + savedLink.sprintId &&
    tab === "Planning"
      ? savedLink
      : null;
  const selectedBoard =
    selectedDraft &&
    readBoard(browserStore(), selectedDraft.productId, selectedDraft.sourceId);
  if (
    selectedDraft &&
    (!current ||
      azure.items?.state !== "ready" ||
      azure.items.sprint !== selectedDraft.sprintId ||
      azure.reply?.sourceId !== selectedDraft.sourceId ||
      azure.productId !== selectedDraft.productId ||
      azure.reply.team.id !== selectedDraft.team ||
      selectedBoard?.level !== selectedDraft.backlog ||
      selectedBoard?.team !== selectedDraft.team)
  ) {
    const cached = readPlanningCache(selectedDraft);
    return (
      <Page
        title="Sprint planning"
        context={context}
        line={areaOf(snapshot, selectedDraft.areaId)?.name ?? ""}
        actions={
          <button className="btn quiet" onClick={() => selectSprint(null)}>
            All sprints
          </button>
        }
      >
        {cached ? (
          <SprintPlanner
            key={selectedDraft.id}
            scope={{ ...selectedDraft, iteration: cached.iteration }}
            members={cached.members}
            name={cached.name}
            offlineOnly
            openChat={(chat, ref) =>
              openPlanningChat(selectedDraft.areaId, chat, ref)
            }
          />
        ) : (
          <OfflinePlanning key={selectedDraft.id} link={selectedDraft} />
        )}
      </Page>
    );
  }
  if (current) {
    const row = sprintRow(current, now);
    const sourceId = azure.reply?.sourceId;
    const board =
      sourceId && readBoard(browserStore(), azure.productId, sourceId);
    const iteration = azure.reply?.sprints.find(
      (entry) => entry.id === openAzure,
    );
    const planner =
      board &&
      sourceId &&
      board.level &&
      iteration &&
      board.team === azure.reply?.team.id
        ? {
            areaId: current.workAreaId,
            productId: azure.productId,
            sourceId,
            team: board.team,
            backlog: board.level,
            sprintId: iteration.id,
            iteration: iteration.path,
          }
        : null;
    const projectStories = current.stories.filter((story) =>
      matchesProjectTag(azureDetail.get(story.id)?.labels, sprintFilter.tag),
    );
    const filteredSprint = !!(
      planner &&
      sprintFilter.tag &&
      !sprintFilter.full
    );
    const visibleStories = filteredSprint ? projectStories : current.stories;
    const visibleIds = new Set(visibleStories.map((s) => s.id));
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
          current.start && current.end
            ? `${shortDate(current.start)} – ${shortDate(current.end)}`
            : "Dates not set",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <button
              className="btn quiet"
              onClick={() => {
                inspectView({
                  view: "All sprints",
                  areaId: current.workAreaId,
                  record: current.id,
                  source: "Sprint detail",
                });
                selectSprint(null);
              }}
            >
              All sprints
            </button>
            <button className="btn" onClick={() => void discussSprint()}>
              Discuss sprint
            </button>
            <div className="rb-seg" role="tablist" aria-label="Sprint detail">
              {sprintTabs
                .filter((name) => name !== "Planning" || openAzure)
                .map((name) => (
                  <button
                    key={name}
                    role="tab"
                    aria-selected={tab === name}
                    onClick={() => {
                      inspectView({
                        view: name,
                        project: current.workAreaName,
                        areaId: current.workAreaId,
                        record: current.id,
                        source: "Sprint detail",
                      });
                      setTab(name);
                    }}
                  >
                    {name}
                  </button>
                ))}
            </div>
          </>
        }
        footer={footer}
      >
        {planner && tab !== "Planning" && azure.items?.state === "ready" && (
          <ProjectFilter
            filter={sprintFilter}
            labels={azure.items.items.flatMap((s) => s.labels ?? [])}
            matching={projectStories.length}
            total={current.stories.length}
            noun="sprint"
          />
        )}
        {filteredSprint && !visibleStories.length && (
          <p>No stories match the saved project filter in this sprint.</p>
        )}
        {tab === "Planning" &&
          (planner &&
          azure.items?.sprint === openAzure &&
          azure.items?.state === "ready" ? (
            <SprintPlanner
              key={JSON.stringify(planner)}
              scope={planner}
              name={current.name}
              openBlockers={snapshot.blockers.reduce<Record<string, number>>(
                (counts, b) => {
                  if (
                    b.workAreaId === current.workAreaId &&
                    !b.resolvedAt &&
                    b.sprintLink?.sourceId === planner.sourceId &&
                    b.sprintLink.sprintId === current.id
                  )
                    counts[b.sprintLink.storyId] =
                      (counts[b.sprintLink.storyId] ?? 0) + 1;
                  return counts;
                },
                {},
              )}
              refreshMembers={() => openAzure && openSprint(openAzure)}
              members={current.stories}
              destinations={azure.reply?.sprints ?? []}
              openChat={(chat, ref) =>
                openPlanningChat(current.workAreaId, chat, ref)
              }
            />
          ) : (
            <p className="muted" role="status">
              {planner
                ? "Current sprint membership must be loaded before planning."
                : "Choose the connected project, team and backlog in Backlog to plan this sprint."}
            </p>
          ))}
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
            <SprintBlockers
              key={JSON.stringify([current.workAreaId, current.id])}
              {...(openAzure && azure.reply
                ? { teamId: azure.reply.team.id }
                : {})}
              refresh={() => openAzure && openSprint(openAzure)}
              blockers={snapshot.blockers.filter(
                (b) =>
                  !filteredSprint ||
                  !b.sprintLink ||
                  visibleIds.has(b.sprintLink.storyId),
              )}
              areaId={current.workAreaId}
              project={current.workAreaName}
              sprintId={current.id}
              name={current.name}
              sourceId={
                openAzure ? (azure.reply?.sourceId ?? azure.sourceId) : "amun"
              }
              stories={visibleStories}
              now={now}
              discuss={discussSprint}
            />
            {current.changedInAdo && (
              <p className="muted small">
                Someone changed this sprint in Azure DevOps. Amun shows the
                change and never reverts it.
              </p>
            )}
          </div>
        )}
        {(tab === "Stories" || tab === "Summary") &&
          (openAzure &&
          azure.items?.sprint === openAzure &&
          !current.stories.length ? (
            <p className="muted" role="status">
              {azure.items.state === "loading"
                ? sprintReplies.itemsLoading
                : azure.items.state === "error"
                  ? sprintReplies.itemsLost
                  : sprintReplies.itemsNone}
            </p>
          ) : visibleStories.length ? (
            <div className="rb-board">
              {[
                ...new Set(
                  visibleStories.map(
                    (story) => azureDetail.get(story.id)?.state ?? "Planned",
                  ),
                ),
              ].map((state) => (
                <section className="rb-col" key={state} aria-label={state}>
                  <header>{state}</header>
                  {visibleStories
                    .filter(
                      (story) =>
                        (azureDetail.get(story.id)?.state ?? "Planned") ===
                        state,
                    )
                    .map((story) => (
                      <div className="rb-tile" key={story.id}>
                        <span className="name">{story.title}</span>
                        <span className="meta">
                          {story.owner ??
                            (story.points === null
                              ? "Not sized"
                              : `${story.points} points`)}
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
      <ResumePlanning
        areas={
          new Set(
            areas.filter((a) => !areaId || a.id === areaId).map((a) => a.id),
          )
        }
        open={(link) => {
          setSavedLink(link);
          setAreaId(link.areaId);
          selectSprint({ workAreaId: link.areaId, id: "ado:" + link.sprintId });
          setTab("Planning");
        }}
      />
      {view === "overview" && (
        <section aria-labelledby="rb-sprints-h">
          <h2 id="rb-sprints-h">Sprints by status</h2>
          <p className="muted small" style={{ margin: "4px 0 12px" }}>
            As of {shortDate(new Date(now).toISOString())} · Select a sprint to
            open it.
          </p>
          {Object.entries(groups)
            .filter(([, members]) => members.length)
            .map(([label, members]) => {
              const rows = (
                <div className="rb-rows">
                  {members.map((sprint) => {
                    const row = sprintRow(sprint, now);
                    return (
                      <button
                        key={JSON.stringify([sprint.workAreaId, sprint.id])}
                        className="rb-rowitem"
                        onClick={() => {
                          inspectView({
                            view: sprint.name,
                            project: sprint.workAreaName,
                            areaId: sprint.workAreaId,
                            record: sprint.id,
                            source: "Sprints",
                          });
                          selectSprint(sprint);
                          setTab("Summary");
                        }}
                      >
                        <span>
                          <span className="name">{row.title}</span>
                          <span
                            className="muted small"
                            style={{ display: "block" }}
                          >
                            {[
                              sprint.team,
                              sprint.start && sprint.end
                                ? `${shortDate(sprint.start)} – ${shortDate(sprint.end)}`
                                : "Dates not set",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span
                            className="muted small"
                            style={{ display: "block" }}
                          >
                            {sprint.goal}
                          </span>
                        </span>
                        <span className="muted">{row.progress}</span>
                        <span>
                          <span
                            className="muted small"
                            style={{ display: "block" }}
                          >
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
              );
              return label === "Completed" ? (
                <details key={label}>
                  <summary>
                    {label} ({members.length})
                  </summary>
                  {rows}
                </details>
              ) : (
                <section key={label} aria-label={label}>
                  <h3>{label}</h3>
                  {rows}
                </section>
              );
            })}
          {!Object.values(groups).some((members) => members.length) && (
            <p className="muted">No sprints to show yet.</p>
          )}
        </section>
      )}
      {view === "timeline" && (
        <section aria-labelledby="rb-timeline-h">
          <h2 id="rb-timeline-h">Sprint dates across teams</h2>
          <p className="muted small" style={{ margin: "4px 0 12px" }}>
            Solid = current or upcoming sprint · Outline = next draft
          </p>
          <SprintTimeline
            snapshot={snapshot}
            sprints={overview}
            range={range}
            weeks={weeks}
            onOpen={(sprint) =>
              sprint.draft ? setView("plan") : selectSprint(sprint)
            }
          />
          {!overview.length && (
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
/** A status as the owner reads it: "active" shows as "Active". */
export function statusLabel(status: string): string {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : status;
}
/** The filters the owner set, kept while they visit a conversation and come back. */
const portfolioFilters = { type: "", status: "", group: "" };
export function Portfolio({
  snapshot,
  model,
  now = Date.now(),
  onWork,
  onResume,
  onAsk,
  onAskAbout,
  onAskCard,
}: {
  onResume?(link: SavedPlanningLink): void;
  snapshot: Snapshot;
  model: string | null;
  now?: number;
  onWork(areaId: string): void;
  /** Sends a message to Firstmate, the same way Home does. */
  onAsk(text: string, files: string[]): void;
  /** Opens a work's conversation with a message for Firstmate. */
  onAskAbout?(areaId: string, text: string): void;
  /** "Ask about …": a fresh chat with the card attached. */
  onAskCard?(areaId: string): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [type, setTypeState] = useState(portfolioFilters.type);
  const [status, setStatusState] = useState(portfolioFilters.status);
  const [group, setGroupState] = useState(portfolioFilters.group);
  const setType = (value: string) => {
    portfolioFilters.type = value;
    setTypeState(value);
  };
  const setStatus = (value: string) => {
    portfolioFilters.status = value;
    setStatusState(value);
  };
  const setGroup = (value: string) => {
    portfolioFilters.group = value;
    setGroupState(value);
  };
  const all = areasInScope(snapshot);
  const areas = all.filter(
    (area) =>
      (!type || area.type === type) &&
      (!status || area.status === status) &&
      (!group || area.groupId === group),
  );
  const statuses = [...new Set(all.map((area) => area.status))];
  // Products and projects get the progress card, at risk first; the rest
  // keep the small card.
  const tracked = portfolioOrder(
    areas.filter((area) => area.type === "product" || area.type === "project"),
    now,
  );
  const others = areas.filter(
    (area) => area.type !== "product" && area.type !== "project",
  );
  const current = all.find((area) => area.id === open) ?? null;
  const objectives = snapshot.objectives.filter(
    (item) =>
      (!group || item.groupId === group) &&
      (item.groupId === null ||
        all.some((area) => area.groupId === item.groupId)),
  );
  return (
    <Page
      title="Portfolio"
      wide
      line="Every product, project, task and RFP. Open one to see where it stands."
      footer={
        <Composer
          placeholder="Ask Firstmate. Its answer opens in the conversation."
          skills
          model={model}
          agents={snapshot.agents
            .filter((agent) => agent.enabled)
            .map((agent) => ({ id: agent.id, name: agent.role }))}
          workAreas={snapshot.areas.map((area) => ({
            id: area.id,
            name: area.name,
          }))}
          onSend={onAsk}
        />
      }
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
                  {statusLabel(item)}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      {objectives.length > 0 && (
        <div className="rb-work" aria-label="Objectives">
          {objectives.map((objective) => (
            <div className="rb-inline" key={objective.id}>
              <div className="row">
                <strong className="grow">{objective.metric}</strong>
                <span className="tag">Objective</span>
              </div>
              <span className="muted small">{objectiveLine(objective)}</span>
              <span className="muted small">
                {objective.links.length
                  ? `Linked to ${objective.links
                      .map((id) => areaOf(snapshot, id)?.name)
                      .filter(Boolean)
                      .join(", ")}`
                  : "Not linked to any work yet"}
              </span>
            </div>
          ))}
        </div>
      )}
      {tracked.length > 0 && (
        <>
          <p className="muted small rb-count" role="status">
            {tracked.length} shown · at risk first, then by nearest date
          </p>
          <div className="rb-pgrid">
            {tracked.map((area) => (
              <div key={area.id}>
                <ProgressCard
                  area={area}
                  snapshot={snapshot}
                  now={now}
                  onOpen={() => setOpen(area.id)}
                />
                {onResume && (
                  <ResumePlanning areas={new Set([area.id])} open={onResume} />
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {current && (
        <WorkSheet
          key={current.id}
          area={current}
          snapshot={snapshot}
          now={now}
          onClose={() => setOpen(null)}
          onWork={onWork}
          onAsk={(areaId, text) =>
            onAskAbout ? onAskAbout(areaId, text) : onWork(areaId)
          }
          {...(onAskCard && { onAskAbout: onAskCard })}
        />
      )}
      {areas.length ? (
        <div className="rb-work">
          {others.map((area) => {
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
                    area.type === "project" ? area.client : null,
                    groupName(snapshot, area.groupId) ?? "No group yet",
                    statusLabel(area.status),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {area.purpose && <span className="meta">{area.purpose}</span>}
                {openBlockers(snapshot.blockers, area.id).map((item) => (
                  <span className="meta" key={item.id}>
                    Blocked: {item.title} · {blockerLine(item, Date.now())}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">
          {all.length
            ? "Nothing matches these filters."
            : "Work you start appears here."}
        </p>
      )}
    </Page>
  );
}
