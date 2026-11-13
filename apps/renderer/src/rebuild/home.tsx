// Home (handoff §6): Welcome on first use; otherwise date, one "while you
// were away" line, Needs your attention, compact Your work, composer.
import { useState } from "react";
import {
  outcomeNotes,
  type AttentionRow,
} from "../../../../packages/domain/src/work/home.ts";
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
import { Icon } from "../icons.tsx";
import { Composer } from "./composer.tsx";
import { work, workAsync } from "./store.ts";
import {
  formatDate,
  groupName,
  homeModel,
  shortDate,
  trayFor,
  typeLabels,
  type Snapshot,
} from "./view-model.ts";

const lower = (label: string) =>
  label === "RFP" ? label : label.toLowerCase();
export interface IntakeStep {
  step: string;
  text: string;
  files: string[];
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
  onResubmit(text: string, files: string[], groupId: string): void;
  onOpen(areaId: string, firstMessage?: string): void;
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
  const [error, setError] = useState("");
  const create = async (type: string, name: string) => {
    const result = await workAsync("create-area", {
      groupId,
      type: type as "product" | "project" | "task" | "rfp",
      name,
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
              onClick={() => onResubmit(pending.text, pending.files, group.id)}
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
              onClick={() => onOpen(option.id, pending.text)}
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
              if (id) onOpen(id, pending.text);
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
                  if (id) onOpen(id, pending.text);
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
            workAreaIds: [id],
          });
          onOpen(id, pending.text);
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

function Row({
  snapshot,
  row,
  expanded,
  onToggle,
  onOpen,
  onAccepted,
}: {
  snapshot: Snapshot;
  row: AttentionRow;
  expanded: boolean;
  onToggle(): void;
  onOpen(): void;
  onAccepted(note: string): void;
}) {
  const [menu, setMenu] = useState(false);
  const [all, setAll] = useState(false);
  const tray = expanded ? trayFor(snapshot, row.id) : null;
  const primary = () => {
    if (row.primary === "Review changes" && row.tray) return onToggle();
    if (row.primary === "Yes, draft it") {
      work("resolve-attention", { attentionId: row.id, resolution: "accept" });
      return onAccepted(outcomeNotes.draft);
    }
    if (row.primary === "View findings")
      work("resolve-attention", { attentionId: row.id, resolution: "done" });
    onOpen();
  };
  return (
    <>
      {/* The whole row opens the conversation for a pointer; the title is the
          control for keyboard and assistive technology. It never approves. */}
      <div className="rb-att" onClick={onOpen}>
        <div>
          <div className="label">{row.label}</div>
          <button
            className="title"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {row.title}
          </button>
          {row.detail && <div className="detail">{row.detail}</div>}
        </div>
        <div
          className="row"
          style={{ position: "relative" }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {row.primary && (
            <button
              className="btn"
              aria-expanded={row.tray ? expanded : undefined}
              onClick={primary}
            >
              {row.primary}
            </button>
          )}
          <button
            className="btn icon-btn"
            aria-label={`More actions for ${row.title}`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
            onBlur={() => setTimeout(() => setMenu(false), 120)}
          >
            <Icon name="more" width={18} height={18} />
          </button>
          {menu && (
            <div
              className="rb-menu"
              role="menu"
              style={{ right: 0, top: "calc(100% + 4px)" }}
            >
              {row.overflow.map((action) => (
                <button
                  key={action}
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setMenu(false);
                    if (action === "Open project") onOpen();
                    else
                      work("resolve-attention", {
                        attentionId: row.id,
                        resolution:
                          action === "Acknowledge" ? "done" : "snooze",
                      });
                  }}
                >
                  {action}
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
              onClick={() => work("request-changes", { planId: tray.plan.id })}
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
  onPortfolio,
  onPendingDone,
  onNote,
}: {
  snapshot: Snapshot;
  now: number;
  model: string | null;
  pending: IntakeStep | null;
  note: string;
  connected: string[];
  onSend(text: string, files: string[]): void;
  onResubmit(text: string, files: string[], groupId: string): void;
  onOpen(areaId: string | null, firstMessage?: string): void;
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
  const rows = (filter === "open" ? view.rows : view.done).filter((row) => {
    if (!kinds) return true;
    const item = snapshot.attention.find((entry) => entry.id === row.id);
    return item ? kinds.includes(item.kind) : false;
  });
  const openRow = (id: string) => {
    const item = snapshot.attention.find((entry) => entry.id === id);
    onOpen(item?.workAreaId ?? null);
  };
  const card = pending && (
    <IntakeCard
      snapshot={snapshot}
      pending={pending}
      connected={connected}
      onResubmit={onResubmit}
      onOpen={(areaId, first) => onOpen(areaId, first)}
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
          {card}
        </div>
      )}
      <Composer
        key={seed?.nonce ?? "composer"}
        initial={seed?.text ?? ""}
        autoFocus
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
  if (view.welcome)
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
                              : "Start a task: ",
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
            <span className="count">{view.rows.length}</span>
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
                onToggle={() =>
                  setExpanded(expanded === row.id ? null : row.id)
                }
                onOpen={() => openRow(row.id)}
                onAccepted={onNote}
              />
            ))
          ) : (
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
