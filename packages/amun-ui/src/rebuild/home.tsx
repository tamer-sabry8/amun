// Home (handoff §6): Welcome on first use; otherwise date, one "while you
// were away" line, Needs your attention, compact Your work, composer.
import { homeDraftKey } from "./chat-memory.ts";
import {
  rfpDetails,
  statedDueDate,
  statedPriority,
} from "../../../../packages/domain/src/work/model.ts";
import { acceptOffer, requestPlanChanges } from "./accept-offer.ts";
import { useState, useSyncExternalStore } from "react";
import { tickedTasks, type Ticked } from "./ticked-tasks.ts";
import { type AttentionRow } from "../../../../packages/domain/src/work/home.ts";
import { welcomeCards } from "../../../../packages/domain/src/work/shell.ts";
import {
  route,
  planDestinations,
  trackerName,
} from "../../../../packages/domain/src/work/flows.ts";
import {
  gateLabels,
  type Gate,
} from "../../../../packages/domain/src/work/permissions.ts";
import { reminderTime } from "../../../../packages/domain/src/work/reminders.ts";
import {
  heldProject,
  helpRequest,
  isHeld,
  laterDays,
} from "../../../../packages/domain/src/work/held-tasks.ts";
import { BlockerRow } from "./blocker-row.tsx";
import { FirstmateMark } from "./firstmate-mark.tsx";
import { Icon } from "../icons.tsx";
import { Composer } from "./composer.tsx";
import { work, workAsync } from "./store.ts";
import {
  formatDate,
  groupName,
  homeModel,
  areaOf,
  scopedBlockers,
  shortDate,
  trayFor,
  typeLabels,
  type Snapshot,
} from "./view-model.ts";

const lower = (label: string) =>
  label === "RFP" || label === "Initiative" ? label : label.toLowerCase();
export interface IntakeStep {
  step: string;
  text: string;
  files: string[];
  pickedFiles?: File[];
  title?: string;
  type?: string;
  groupId?: string | null;
  recordId?: string;
  options?: { id: string; name: string }[];
}

/** One card for whatever intake still needs: group, link, work area, objective or route. */
export function IntakeCard({
  snapshot,
  pending,
  connected,
  onResubmit,
  onOpen,
  onDone,
}: {
  snapshot: Snapshot;
  pending: IntakeStep;
  connected: string[];
  onResubmit(
    text: string,
    files: string[],
    groupId: string,
    picked?: File[],
  ): void;
  onOpen(areaId: string, firstMessage?: string, firstFiles?: File[]): void;
  onDone(note?: string): void;
}) {
  const groupId = pending.groupId ?? null;
  const areas = snapshot.areas.filter(
    (area) => !groupId || area.groupId === groupId,
  );
  const [metric, setMetric] = useState(pending.title ?? "");
  const [baseline, setBaseline] = useState("");
  const [target, setTarget] = useState(
    /(\d{1,3})\s?%/.exec(pending.text)?.[1] ?? "",
  );
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const create = async (type: string, name: string) => {
    if (type === "rfp") {
      // The same record as Track an RFP, with the facts the request states.
      const facts = rfpDetails(pending.text);
      const result = await workAsync("save-rfp", {
        groupId,
        name,
        client: facts.client ?? "",
        deadline: facts.deadline,
        responseOwner: facts.responseOwner,
        accountOwner: facts.accountOwner,
        presales: facts.presales,
      });
      return result.ok ? result.ref : null;
    }
    // "…for client X", read the same way an RFP's client is.
    const client = type === "project" ? rfpDetails(pending.text).client : null;
    const priority = statedPriority(pending.text);
    const dueDate = statedDueDate(
      pending.text,
      new Date().toISOString().slice(0, 10),
    );
    const result = await workAsync("create-area", {
      // The owner's own message follows into this work, so Firstmate knows.
      told: true,
      groupId,
      type: type as "product" | "project" | "task" | "rfp",
      name,
      ...(client ? { client } : {}),
      ...(priority ? { priority } : {}),
      ...(dueDate ? { dueAt: dueDate } : {}),
    });
    return result.ok ? result.ref : null;
  };
  if (pending.step === "ask_group")
    return (
      <div className="rb-inline" role="group" aria-label="Choose a group">
        <strong>Which group is this for?</strong>
        <div className="row wrap">
          {snapshot.groups.map((group) => (
            <button
              key={group.id}
              className="btn"
              onClick={() =>
                onResubmit(
                  pending.text,
                  pending.files,
                  group.id,
                  pending.pickedFiles,
                )
              }
            >
              {group.name}
            </button>
          ))}
          {!snapshot.groups.length && (
            <span className="muted">
              Add a group in Settings › Groups and routing first.
            </span>
          )}
        </div>
        <span className="note">
          Information stays inside the group you choose.
        </span>
      </div>
    );
  if (pending.step === "save_record" && pending.recordId) {
    const link = async (
      choice: "link" | "later" | "never",
      areaId?: string,
    ) => {
      const result = await workAsync("link-record", {
        recordId: pending.recordId!,
        choice,
        workAreaIds: areaId ? [areaId] : [],
      });
      if (!result.ok) return setError(result.message);
      if (areaId) onOpen(areaId);
      else
        onDone(
          choice === "later"
            ? "Saved. It’s in Library › Needs linking."
            : "Saved without a link. I won’t ask again.",
        );
    };
    return (
      <div className="rb-inline" role="group" aria-label="Link this record">
        <strong>
          Saved as{" "}
          {pending.type === "idea" || pending.type === "interview" ? "an" : "a"}{" "}
          {pending.type}. Where does it belong?
        </strong>
        <div className="row wrap">
          {areas.map((area) => (
            <button
              key={area.id}
              className="btn"
              onClick={() => link("link", area.id)}
            >
              {area.name}
            </button>
          ))}
          <button className="btn quiet" onClick={() => link("later")}>
            Link later
          </button>
          <button className="btn quiet" onClick={() => link("never")}>
            Leave unlinked
          </button>
        </div>
        {error && <span className="note">{error}</span>}
        <span className="note">Nothing was added to a backlog or roadmap.</span>
      </div>
    );
  }
  if (pending.step === "choose_work") {
    const label = typeLabels[pending.type as keyof typeof typeLabels] ?? "Work";
    return (
      <div
        className="rb-inline"
        role="group"
        aria-label="Choose where this belongs"
      >
        <strong>Where does this belong?</strong>
        <span className="muted">“{pending.title}”</span>
        <div className="row wrap">
          {(pending.options ?? []).map((option) => (
            <button
              key={option.id}
              className="btn"
              onClick={() =>
                onOpen(option.id, pending.text, pending.pickedFiles)
              }
            >
              {option.name}
            </button>
          ))}
          <button
            className="btn primary"
            onClick={async () => {
              const id = await create(
                pending.type ?? "task",
                pending.title ?? "Untitled",
              );
              if (id) onOpen(id, pending.text, pending.pickedFiles);
            }}
          >
            New {lower(label)}
          </button>
          {(["product", "project", "task", "rfp"] as const)
            .filter((type) => type !== pending.type)
            .map((type) => (
              <button
                key={type}
                className="btn quiet"
                onClick={async () => {
                  const id = await create(type, pending.title ?? "Untitled");
                  if (id) onOpen(id, pending.text, pending.pickedFiles);
                }}
              >
                New {lower(typeLabels[type])}
              </button>
            ))}
        </div>
      </div>
    );
  }
  if (pending.step === "define_objective")
    return (
      <form
        className="rb-inline"
        aria-label="Define the objective"
        onSubmit={async (event) => {
          event.preventDefault();
          const id = await create("task", pending.title ?? metric);
          if (!id) return;
          const number = (value: string) =>
            value.trim() === "" ? null : Number(value);
          await workAsync("save-objective", {
            groupId,
            metric,
            baseline: number(baseline),
            target: number(target),
            current: number(baseline),
            dueDate: due || null,
            workAreaIds: [id],
          });
          onOpen(id, pending.text, pending.pickedFiles);
        }}
      >
        <strong>
          That sounds like a measurable objective. What are we measuring?
        </strong>
        <label className="field">
          Measure
          <input
            type="text"
            required
            value={metric}
            maxLength={200}
            onChange={(event) => setMetric(event.target.value)}
          />
        </label>
        <div className="rb-route">
          <label className="field">
            Where it is today
            <input
              type="number"
              step="any"
              placeholder="Unknown"
              value={baseline}
              onChange={(event) => setBaseline(event.target.value)}
            />
          </label>
          <label className="field">
            Target
            <input
              type="number"
              step="any"
              placeholder="Not set"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          <label className="field">
            Due date
            <input
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button className="btn primary">Track it</button>
          <span className="note">
            Unknown values stay unknown until there is evidence.
          </span>
        </div>
      </form>
    );
  if (pending.step === "route_execution") {
    const outcome = route({
      groupId,
      workType: "task",
      rules: snapshot.routes,
      connected,
    });
    const title = pending.title ?? "New ticket";
    return (
      <div className="rb-inline" role="group" aria-label="Where to track this">
        <strong>This looks like a ticket.</strong>
        {outcome.step === "ask_group" || outcome.step === "ask_route" ? (
          <>
            <span>Where should tickets for this group be tracked?</span>
            <div className="row wrap">
              {[...connected.filter((tool) => tool !== "obsidian"), "amun"].map(
                (tracker) => (
                  <button
                    key={tracker}
                    className="btn"
                    disabled={!groupId}
                    onClick={() =>
                      groupId &&
                      work("set-route", { groupId, condition: null, tracker })
                    }
                  >
                    {tracker === "amun"
                      ? "Keep it in Amun"
                      : trackerName(tracker)}
                  </button>
                ),
              )}
            </div>
            <span className="note">
              I’ll remember the choice for this group.
            </span>
          </>
        ) : outcome.step === "blocked" ? (
          <span>{outcome.reason}</span>
        ) : (
          <>
            <span>
              It belongs in {trackerName(outcome.tracker)}.
              {outcome.step === "ask_approval" && outcome.gate
                ? ` ${gateLabels[outcome.gate as Gate]} always needs your approval.`
                : ""}
            </span>
            <div className="row">
              <button
                className="btn primary"
                onClick={async () => {
                  await workAsync("propose-plan", {
                    groupId,
                    workAreaId: null,
                    planKind: "edit",
                    destination: outcome.tracker,
                    summary: `1 ticket ready for ${trackerName(outcome.tracker)}`,
                    items: [
                      {
                        id: crypto.randomUUID(),
                        summary: title,
                        fields: { title },
                      },
                    ],
                  });
                  onDone("Proposed. Review it under Needs your attention.");
                }}
              >
                Propose it for review
              </button>
              <button className="btn quiet" onClick={() => onDone()}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    );
  }
  return null;
}

/** Ticked Firstmate tasks, kept while the owner is on other screens. */
const ticks = tickedTasks((attentionId) =>
  work("resolve-attention", { attentionId, resolution: "done" }),
);

function Row({
  snapshot,
  row,
  expanded,
  ticked,
  onToggle,
  onOpen,
  onAccepted,
  onTick,
  onHelp,
}: {
  snapshot: Snapshot;
  row: AttentionRow;
  expanded: boolean;
  /** Set while a ticked task is still shown in the open list. */
  ticked: Ticked | null;
  onToggle(): void;
  onOpen(): void;
  onAccepted(note: string): void;
  /** Ticks or unticks a Firstmate task; nothing is sent until Undo has passed. */
  onTick(done: boolean): void;
  /** "Help me do it": the request goes to Firstmate in a chat. */
  onHelp(): void;
}) {
  const [menu, setMenu] = useState(false);
  const [later, setLater] = useState(false);
  const held = isHeld(row.id);
  // A Firstmate reminder filed under a project is that project's task.
  const project = held ? heldProject(row.title, snapshot.areas) : null;
  const crewQuestion = held && row.id.split(":").length > 2;
  const label = crewQuestion
    ? "Question"
    : held
      ? project
        ? `Task · ${project}`
        : "Reminder"
      : row.label;
  const overflow = held
    ? ["Done, close it", "Remind me later", "Help me do it"]
    : row.overflow;
  const [all, setAll] = useState(false);
  const tray = expanded ? trayFor(snapshot, row.id) : null;
  const primary = () => {
    if (row.primary === "Review changes" && row.tray) return onToggle();
    if (row.primary === "Yes, draft it") {
      const item = snapshot.attention.find((entry) => entry.id === row.id);
      if (!item) return;
      const accepted = acceptOffer(item);
      onAccepted(accepted.note);
      // The draft is asked for in the work's own conversation.
      return accepted.areaId ? onOpen() : undefined;
    }
    if (row.primary === "View findings")
      work("resolve-attention", { attentionId: row.id, resolution: "done" });
    onOpen();
  };
  return (
    <>
      {/* The whole row opens the conversation for a pointer; the title is the
          control for keyboard and assistive technology. It never approves. */}
      <div className={"rb-att" + (project ? " task" : "")} onClick={onOpen}>
        {project && (
          <input
            type="checkbox"
            className="tick"
            aria-label={`Mark complete: ${row.title}`}
            checked={!!ticked}
            disabled={!!ticked?.sent}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onTick(event.target.checked)}
          />
        )}
        <div className={ticked ? "ticked" : undefined}>
          <div className="label">{label}</div>
          <button
            className="title"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {row.title}
          </button>
          {ticked ? (
            <div className="detail" role="status">
              Done. Firstmate is closing it.
              {!ticked.sent && (
                <>
                  {" "}
                  <button
                    className="link"
                    onClick={(event) => {
                      event.stopPropagation();
                      onTick(false);
                    }}
                  >
                    Undo
                  </button>
                </>
              )}
            </div>
          ) : (
            row.detail && <div className="detail">{row.detail}</div>
          )}
        </div>
        <div
          className="row"
          style={{ position: "relative" }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {row.primary && !held && (
            <button
              className="btn"
              aria-expanded={row.tray ? expanded : undefined}
              onClick={primary}
            >
              {row.primary}
            </button>
          )}
          {!ticked && overflow.length > 0 && (
            <button
              className="btn icon-btn"
              aria-label={`More actions for ${row.title}`}
              aria-expanded={menu}
              onClick={() => {
                setMenu(!menu);
                setLater(false);
              }}
              onBlur={() =>
                setTimeout(() => {
                  setMenu(false);
                  setLater(false);
                }, 120)
              }
            >
              <Icon name="more" width={18} height={18} />
            </button>
          )}
          {menu && (
            <div
              className="rb-menu"
              role="menu"
              style={{ right: 0, top: "calc(100% + 4px)", minWidth: 220 }}
            >
              {later
                ? laterDays(new Date()).map((option) => (
                    <button
                      key={option.day}
                      role="menuitem"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setMenu(false);
                        setLater(false);
                        work("resolve-attention", {
                          attentionId: row.id,
                          resolution: "snooze",
                          until: option.day,
                        });
                      }}
                    >
                      {option.label}
                    </button>
                  ))
                : overflow.map((action) => (
                    <button
                      key={action}
                      role="menuitem"
                      aria-haspopup={
                        action === "Remind me later" ? "menu" : undefined
                      }
                      className={
                        action === "Remind me later" ? "more" : undefined
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (action === "Remind me later") return setLater(true);
                        setMenu(false);
                        if (action === "Open project") onOpen();
                        else if (action === "Done, close it") onTick(true);
                        else if (action === "Help me do it") onHelp();
                        else
                          work("resolve-attention", {
                            attentionId: row.id,
                            resolution:
                              action === "Acknowledge" ? "done" : "snooze",
                          });
                      }}
                    >
                      {action}
                      {action === "Remind me later" && (
                        <Icon name="chevron" width={12} height={12} />
                      )}
                    </button>
                  ))}
            </div>
          )}
        </div>
      </div>
      {tray && (
        <div className="rb-tray">
          <strong>{tray.plan.summary}</strong>
          <span className="muted small">
            To {planDestinations(tray.plan)} · nothing is published until you
            approve
          </span>
          {all ? (
            <ol>
              {tray.plan.items.map((item) => (
                <li key={item.id}>{item.summary}</li>
              ))}
            </ol>
          ) : (
            <button
              className="link"
              style={{ justifySelf: "start" }}
              onClick={() => setAll(true)}
            >
              {tray.showAll}
            </button>
          )}
          <div className="row">
            <button
              className="btn primary"
              onClick={() =>
                // The fingerprint binds the approval to exactly what is shown.
                work("approve-plan", {
                  planId: tray.plan.id,
                  fingerprint: tray.plan.fingerprint,
                })
              }
            >
              {tray.approve}
            </button>
            <button
              className="btn"
              onClick={() => requestPlanChanges(tray.plan)}
            >
              Request changes
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function Home({
  snapshot,
  now,
  model,
  pending,
  note,
  connected,
  onSend,
  onResubmit,
  onOpen,
  onOpenDecision,
  onPortfolio,
  onPendingDone,
  onNote,
}: {
  snapshot: Snapshot;
  onOpenDecision?(id: string): void;
  now: number;
  model: string | null;
  pending: IntakeStep | null;
  note: string;
  connected: string[];
  onSend(text: string, files: string[], picked?: File[]): void;
  onResubmit(
    text: string,
    files: string[],
    groupId: string,
    picked?: File[],
  ): void;
  onOpen(
    areaId: string | null,
    firstMessage?: string,
    firstFiles?: File[],
  ): void;
  onPortfolio(): void;
  onPendingDone(note?: string): void;
  onNote(note: string): void;
}) {
  const view = homeModel(snapshot, now);
  const [filter, setFilter] = useState<"open" | "done">("open");
  const [kinds, setKinds] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(
    null,
  );
  // Firstmate tasks the owner ticked: shown struck through for a while, with
  // Undo until the request goes to Firstmate, then they move to Done.
  const ticked = useSyncExternalStore(ticks.subscribe, ticks.get, ticks.get);
  const tick = (id: string, done: boolean) =>
    done ? ticks.tick(id) : ticks.undo(id);
  // A ticked task stays in the open list until its time is up.
  const stillShown = (row: { id: string }) => row.id in ticked;
  const listed =
    filter === "open"
      ? [
          ...view.rows,
          ...view.done.filter(
            (row) =>
              stillShown(row) && !view.rows.some((open) => open.id === row.id),
          ),
        ]
      : view.done.filter((row) => !stillShown(row));
  const rows = listed.filter((row) => {
    if (!kinds) return true;
    const item = snapshot.attention.find((entry) => entry.id === row.id);
    return item ? kinds.includes(item.kind) : false;
  });
  // Blockers wait here with the rest, each with its owner and age.
  const blocked = filter === "open" ? scopedBlockers(snapshot) : [];
  const reminders =
    filter === "open"
      ? snapshot.reminders.filter((item) => item.state === "due")
      : [];
  const openRow = (id: string) => {
    const item = snapshot.attention.find((entry) => entry.id === id);
    if (
      onOpenDecision &&
      item &&
      (item.id.startsWith("sprint-held:") ||
        item.id.startsWith("blocker-review:"))
    ) {
      onOpenDecision(item.id);
      return;
    }
    onOpen(item?.workAreaId ?? null);
  };
  const card = pending && (
    <IntakeCard
      snapshot={snapshot}
      pending={pending}
      connected={connected}
      onResubmit={onResubmit}
      onOpen={(areaId, first, firstFiles) => onOpen(areaId, first, firstFiles)}
      onDone={onPendingDone}
    />
  );
  const footer = (chips: string[], placeholder: string) => (
    <>
      {note && (
        <p className="muted small" role="status" style={{ marginTop: 16 }}>
          {note}
        </p>
      )}
      {card && (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {/* What was just sent stays visible while Firstmate asks about it. */}
          {pending?.text && <div className="rb-msg you">{pending.text}</div>}
          <div className="rb-msg firstmate">
            <span className="who">
              <FirstmateMark size={18} />
              Firstmate
            </span>
            {card}
          </div>
        </div>
      )}
      <Composer
        key={seed?.nonce ?? "composer"}
        initial={seed?.text ?? ""}
        draftKey={homeDraftKey}
        autoFocus
        skills
        placeholder={placeholder}
        chips={pending ? [] : chips}
        model={model}
        agents={snapshot.agents
          .filter((agent) => agent.enabled)
          .map((agent) => ({ id: agent.id, name: agent.role }))}
        workAreas={snapshot.areas.map((area) => ({
          id: area.id,
          name: area.name,
        }))}
        onSend={onSend}
      />
    </>
  );
  if (view.welcome && !reminders.length)
    return (
      <div className="rb-scroll">
        <div className="rb-page">
          <div className="rb-welcome">
            <h1>Welcome to Amun</h1>
            <p>
              Tell Firstmate what you want done. It keeps the context, does the
              legwork and comes back with decisions and results.
            </p>
            <div className="rb-cards">
              {welcomeCards.map(([id, title, line]) => (
                <button
                  key={id}
                  className="rb-card"
                  onClick={() =>
                    setSeed({
                      nonce: Date.now(),
                      text:
                        id === "product"
                          ? "Create a product called "
                          : id === "idea"
                            ? "I have an idea: "
                            : id === "rfp"
                              ? "Track an RFP from "
                              : "Start an Initiative: ",
                    })
                  }
                >
                  <strong>{title}</strong>
                  <span>{line}</span>
                </button>
              ))}
            </div>
            {connected.length === 0 && (
              <p className="small">
                No tools are connected yet. Firstmate will ask when a step needs
                one.
              </p>
            )}
          </div>
          {footer(
            [],
            "Describe an objective, paste notes, or drop in a document",
          )}
        </div>
      </div>
    );
  return (
    <div className="rb-scroll">
      <div className="rb-page">
        <header className="rb-head">
          <h1>{formatDate(now)}</h1>
          {view.away && (
            <button
              className="link"
              style={{ justifySelf: "start" }}
              aria-pressed={kinds !== null}
              onClick={() => setKinds(kinds ? null : view.away!.kinds)}
            >
              {view.away.text}
            </button>
          )}
          {view.linkingLine && (
            <p className="muted small">{view.linkingLine}</p>
          )}
        </header>
        <section className="rb-panel" aria-labelledby="rb-att-h">
          <header>
            <h2 id="rb-att-h">Needs your attention</h2>
            <span className="count">
              {view.rows.length + blocked.length + reminders.length}
            </span>
            <span className="grow" />
            {kinds && (
              <button className="btn quiet" onClick={() => setKinds(null)}>
                Show everything
              </button>
            )}
            <div className="rb-seg" role="group" aria-label="Show">
              <button
                aria-pressed={filter === "open"}
                onClick={() => setFilter("open")}
              >
                Open
              </button>
              <button
                aria-pressed={filter === "done"}
                onClick={() => setFilter("done")}
              >
                Done
              </button>
            </div>
          </header>
          {blocked.map((item) => (
            <BlockerRow
              key={item.id}
              blocker={item}
              projectName={areaOf(snapshot, item.workAreaId)?.name}
              now={now}
              onOpen={() => onOpen(item.workAreaId)}
            />
          ))}
          {reminders.map((item) => (
            <div className="rb-att" key={item.id}>
              <div>
                <div className="label">
                  {item.missedAt
                    ? "Missed at " + reminderTime(item.missedAt, new Date(now))
                    : "Now"}
                  {item.workAreaId &&
                    " · " + areaOf(snapshot, item.workAreaId)?.name}
                </div>
                <div className="title">Reminder: {item.text}</div>
              </div>
              <div className="row">
                <button
                  className="btn"
                  aria-label={`Mark the reminder “${item.text}” as done`}
                  onClick={() =>
                    work("finish-reminder", { reminderId: item.id })
                  }
                >
                  Done
                </button>
                <button
                  className="btn quiet"
                  aria-label={`Snooze the reminder “${item.text}” for 10 minutes`}
                  onClick={() => {
                    work("snooze-reminder", { reminderId: item.id });
                    onNote("Okay. I’ll remind you again in 10 minutes.");
                  }}
                >
                  Snooze 10 minutes
                </button>
              </div>
            </div>
          ))}
          {rows.length ? (
            rows.map((row) => (
              <Row
                key={row.id}
                snapshot={snapshot}
                row={
                  filter === "done"
                    ? { ...row, primary: null, overflow: [], tray: false }
                    : row
                }
                expanded={expanded === row.id}
                ticked={filter === "open" ? (ticked[row.id] ?? null) : null}
                onToggle={() =>
                  setExpanded(expanded === row.id ? null : row.id)
                }
                onOpen={() => openRow(row.id)}
                onAccepted={onNote}
                onTick={(done) => tick(row.id, done)}
                onHelp={() => onSend(helpRequest(row.title), [])}
              />
            ))
          ) : blocked.length || reminders.length ? null : (
            <p className="rb-empty">
              {filter === "open"
                ? "Nothing needs you right now."
                : "Items you have dealt with appear here."}
            </p>
          )}
        </section>
        <div className="rb-section">
          <h2>Your work</h2>
          <span className="grow" />
          <button className="link" onClick={onPortfolio}>
            View all
          </button>
        </div>
        {view.work.length ? (
          <div className="rb-work">
            {view.work.slice(0, 9).map(({ area, note: stale, waiting }) => (
              <button
                key={area.id}
                className="rb-workcard"
                onClick={() => onOpen(area.id)}
              >
                <span className="row">
                  <span className="name grow">{area.name}</span>
                  {waiting > 0 && <span className="count">{waiting}</span>}
                </span>
                <span className="meta">
                  {[
                    typeLabels[area.type],
                    area.type === "project" && area.client,
                    groupName(snapshot, area.groupId),
                    area.dueAt && "Due " + shortDate(area.dueAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {stale && <span className="meta">{stale}</span>}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">Work you start will appear here.</p>
        )}
        {footer(
          [
            "What changed since yesterday?",
            "Draft a stakeholder update",
            "Plan the next sprint",
          ],
          "Ask Firstmate, or give it an objective",
        )}
      </div>
    </div>
  );
}
