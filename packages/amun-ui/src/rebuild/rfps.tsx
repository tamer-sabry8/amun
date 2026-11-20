// The RFPs screen: figures across the top, what needs attention, the
// pipeline in five columns, and one RFP in a panel over the page. The owner
// approved this layout on 20 November 2026 (docs/preview/2026-11-20-portfolio-rfps).
//
// Everything changed here is saved in Amun and told to Firstmate with the
// card (see firstmate-notice.ts); nothing on this screen starts work itself.
import { useEffect, useRef, useState } from "react";
import {
  rfpDetails,
  rfpFromRequest,
} from "../../../../packages/domain/src/work/model.ts";
import {
  filterRfps,
  rfpAttention,
  rfpCard,
  rfpColumn,
  rfpColumnDrop,
  rfpColumnLabels,
  rfpColumns,
  rfpHandoff,
  rfpIsOpen,
  rfpMoney,
  rfpOwners,
  rfpPeople,
  rfpStageLabels,
  rfpStats,
  type RfpColumn,
  type RfpStage,
} from "../../../../packages/domain/src/work/flows.ts";
import type { WorkCommand } from "../../../../packages/contracts/src/work.ts";
import { Icon } from "../icons.tsx";
import { Composer } from "./composer.tsx";
import { work, workAsync } from "./store.ts";
import { areaOf, visibleGroups, type Snapshot } from "./view-model.ts";

type Rfp = Snapshot["rfps"][number];
type RfpPatch = Extract<WorkCommand, { action: "update-rfp" }>["patch"];

const shortDay = (stamp: string) =>
  new Date(stamp).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const dayOnly = (stamp: string) =>
  new Date(stamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
/** The date an input of type "date" holds, as the stamp Amun stores. */
const fromDay = (value: string) =>
  value ? new Date(value + "T00:00:00.000Z").toISOString() : null;

function Faces({ people }: { people: string[] }) {
  if (!people.length) return null;
  return (
    <span className="rb-faces" aria-hidden>
      {people.slice(0, 3).map((person, index) => (
        <span className={"rb-face f" + (index % 4)} key={person}>
          {initials(person)}
        </span>
      ))}
    </span>
  );
}

const columnTone: Record<RfpColumn, string> = {
  new: "info",
  in_progress: "warn",
  on_hold: "hold",
  won: "good",
  lost: "bad",
};

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
  const [open, setOpen] = useState<string | null>(null);
  const [over, setOver] = useState<RfpColumn | null>(null);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const groups = visibleGroups(snapshot);
  const allowed = new Set(
    snapshot.areas
      .filter(
        (area) =>
          groups === null || !area.groupId || groups.includes(area.groupId),
      )
      .map((area) => area.id),
  );
  const tracked = snapshot.rfps.filter((rfp) => allowed.has(rfp.id));
  const name = (id: string) => areaOf(snapshot, id)?.name ?? "RFP";
  const rfps = filterRfps(tracked, { text: search, owner, name });
  const filtering = Boolean(search.trim() || owner);
  const stats = rfpStats(tracked, name, now);
  const attention = rfpAttention(tracked, now);
  const current = tracked.find((rfp) => rfp.id === open) ?? null;

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

  const tile = (
    tone: string,
    label: string,
    figure: { count: number; line: string; detail: string },
  ) => (
    <div className="rb-stat">
      <span className={"rb-dot-label " + tone}>{label}</span>
      <strong>{figure.count}</strong>
      <span className="line">{figure.line}</span>
      {figure.detail && <span className="detail">{figure.detail}</span>}
    </div>
  );

  const card = (rfp: Rfp) => {
    const view = rfpCard(rfp, now);
    const column = rfpColumn(rfp);
    const people = rfpPeople(rfp);
    const lead = rfp.responseOwner ?? people[0] ?? null;
    const closed = column === "won" || column === "lost";
    const due = closed
      ? rfp.closedAt
        ? dayOnly(rfp.closedAt)
        : null
      : view.atRisk
        ? view.countdown
        : rfp.deadline
          ? "Due " + shortDay(rfp.deadline)
          : "No deadline";
    const latest = rfp.summaries[0]?.text ?? null;
    return (
      <button
        key={rfp.id}
        className="rb-rfp"
        draggable
        onDragStart={(event) =>
          event.dataTransfer.setData("text/plain", rfp.id)
        }
        onClick={() => setOpen(rfp.id)}
      >
        <span className="top">
          <span className="client">{rfp.client || "Client not set"}</span>
          {due && (
            <span className={"due" + (!closed && view.atRisk ? " soon" : "")}>
              {due}
            </span>
          )}
        </span>
        <span className="name">{name(rfp.id)}</span>
        {column === "on_hold" && (
          <span className="body hold">
            {rfp.holdReason || "On hold, no reason given"}
          </span>
        )}
        {!closed && rfp.nextStep && (
          <span className="body">
            <span className="next">Next</span>
            {rfp.nextStep}
            {rfp.nextStepAt ? " · " + shortDay(rfp.nextStepAt) : ""}
          </span>
        )}
        {column !== "on_hold" && (view.subline || latest) && (
          <span className="body quiet">
            {column === "lost"
              ? (view.subline ?? latest)
              : (latest ?? view.subline)}
          </span>
        )}
        <span className="foot">
          <Faces people={people} />
          {rfp.value !== null && <strong>{rfpMoney(rfp.value)}</strong>}
          <span className={"lead" + (lead ? "" : " none")}>
            {lead ?? (rfpIsOpen(rfp) ? "No response owner" : "No owner")}
          </span>
        </span>
      </button>
    );
  };

  const drop = (id: string, column: RfpColumn) => {
    const dropped = tracked.find((rfp) => rfp.id === id);
    if (!dropped) return;
    const action = rfpColumnDrop(dropped, column);
    if (action.do === "move") void move(id, action.stage);
    if (action.do === "hold") {
      // A hold needs its reason, which is asked for in the RFP's panel.
      work("hold-rfp", { areaId: id, held: true });
      setOpen(id);
    }
  };

  return (
    <div className="rb-scroll">
      <div className="rb-page wide">
        <header className="rb-head">
          <h1>RFPs</h1>
          <p className="muted">Track every RFP from receipt to award.</p>
        </header>

        <div className="rb-stats" aria-label="RFP figures">
          {tile("ink", "Total RFPs", stats.total)}
          {tile("info", "New", stats.new)}
          {tile("warn", "In progress", stats.inProgress)}
          {tile("hold", "On hold", stats.onHold)}
          {tile("good", "Won", stats.won)}
          {tile("bad", "Lost", stats.lost)}
          <div className="rb-stat">
            <span className="rb-dot-label good">Win rate</span>
            <strong>
              {stats.winRate.percent === null ? (
                "—"
              ) : (
                <>
                  {stats.winRate.percent}
                  <small>%</small>
                </>
              )}
            </strong>
            <span className="line">{stats.winRate.line}</span>
            {stats.winRate.percent !== null && (
              <span className="rb-rate" aria-hidden>
                <span style={{ inlineSize: stats.winRate.percent + "%" }} />
              </span>
            )}
          </div>
        </div>

        {attention.length > 0 && (
          <section aria-label="Needs attention">
            <h2 className="rb-sec">
              Needs attention <span className="n">{attention.length}</span>
            </h2>
            <div className="rb-attn">
              {attention.map((item) => (
                <button key={item.id} onClick={() => setOpen(item.id)}>
                  <span
                    className={
                      "rb-dot-label strong " +
                      (item.kind === "hold" ? "hold" : "warn")
                    }
                  >
                    {name(item.id)}
                  </span>
                  <span className="muted small">{item.line}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="rb-sec-row">
          <h2 className="rb-sec">Pipeline</h2>
          <span className="grow" />
          <input
            type="text"
            aria-label="Search RFPs"
            placeholder="Search name or client"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="Filter by person"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">Everyone</option>
            {rfpOwners(tracked).map((person) => (
              <option key={person} value={person}>
                {person}
              </option>
            ))}
          </select>
          {filtering && (
            <button
              className="link small"
              onClick={() => {
                setSearch("");
                setOwner("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="rb-pipe">
          {rfpColumns.map((column) => {
            const inside = rfps.filter((rfp) => rfpColumn(rfp) === column);
            return (
              <section
                key={column}
                className={"rb-lane" + (over === column ? " over" : "")}
                aria-label={rfpColumnLabels[column]}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOver(column);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(null);
                  drop(event.dataTransfer.getData("text/plain"), column);
                }}
              >
                <header>
                  <span className={"rb-dot-label strong " + columnTone[column]}>
                    {rfpColumnLabels[column]}
                  </span>
                  <span className="n">{inside.length}</span>
                </header>
                {inside.map(card)}
              </section>
            );
          })}
        </div>
        {!tracked.length && (
          <p className="muted">
            No RFPs are being tracked. Tell Firstmate about one below.
          </p>
        )}
        {tracked.length > 0 && !rfps.length && (
          <p className="muted" role="status">
            No RFPs match. Clear the filters to see them all.
          </p>
        )}

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
            const request = rfpFromRequest(text, snapshot.groups);
            if (!request.name)
              return setNote("Name the RFP you want to track.");
            const facts = rfpDetails(text, new Date(now));
            const parsed = request.due
              ? Date.parse(request.due + " " + new Date(now).getFullYear())
              : NaN;
            const result = await workAsync("save-rfp", {
              // Only a group the request names; otherwise the one in use.
              groupId: request.groupId ?? snapshot.setup.activeGroupId,
              client: request.client ?? facts.client ?? "",
              name: request.name,
              deadline:
                facts.deadline ??
                (Number.isNaN(parsed) ? null : new Date(parsed).toISOString()),
              responseOwner: facts.responseOwner,
              accountOwner: facts.accountOwner,
              presales: facts.presales,
            });
            setNote(result.ok ? "" : result.message);
            if (result.ref) setOpen(result.ref);
          }}
        />
      </div>
      {current && (
        <RfpSheet
          key={current.id}
          rfp={current}
          name={name(current.id)}
          now={now}
          onClose={() => setOpen(null)}
          onMove={(stage) => void move(current.id, stage)}
          onWork={onWork}
        />
      )}
    </div>
  );
}

type Tab = "details" | "summary" | "team";

/** One RFP, over the page. Closing it returns to the pipeline as it was. */
function RfpSheet({
  rfp,
  name,
  now,
  onClose,
  onMove,
  onWork,
}: {
  rfp: Rfp;
  name: string;
  now: number;
  onClose(): void;
  onMove(stage: RfpStage): void;
  onWork(areaId: string): void;
}) {
  const [tab, setTab] = useState<Tab>("details");
  const sheet = useRef<HTMLDivElement>(null);
  const column = rfpColumn(rfp);
  const handoff = rfpHandoff(rfp);
  const people = rfpPeople(rfp);

  useEffect(() => {
    // Keyboard focus starts inside the panel and Escape closes it.
    sheet.current?.querySelector<HTMLElement>("[data-first]")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  /** Saves the fields save-rfp owns, changing only what is given. */
  const save = (
    change: Partial<
      Pick<
        Rfp,
        "client" | "deadline" | "responseOwner" | "accountOwner" | "presales"
      >
    >,
  ) =>
    work("save-rfp", {
      areaId: rfp.id,
      groupId: null,
      name,
      client: rfp.client,
      deadline: rfp.deadline,
      responseOwner: rfp.responseOwner,
      accountOwner: rfp.accountOwner,
      presales: rfp.presales,
      ...change,
    });
  const patch = (change: RfpPatch) =>
    work("update-rfp", { areaId: rfp.id, patch: change });

  const words = (
    label: string,
    value: string | null,
    onSave: (next: string | null) => void,
    placeholder = "—",
  ) => (
    <label className="rb-fact">
      <span>{label}</span>
      <input
        type="text"
        defaultValue={value ?? ""}
        key={label + (value ?? "")}
        placeholder={placeholder}
        maxLength={200}
        onBlur={(event) => {
          const next = event.target.value.trim() || null;
          if (next !== (value ?? null)) onSave(next);
        }}
      />
    </label>
  );
  const date = (
    label: string,
    value: string | null,
    onSave: (next: string | null) => void,
    under?: string,
  ) => (
    <label className="rb-fact">
      <span>{label}</span>
      <input
        type="date"
        defaultValue={value?.slice(0, 10) ?? ""}
        key={label + (value ?? "")}
        onChange={(event) => onSave(fromDay(event.target.value))}
      />
      {under && <span className="under">{under}</span>}
    </label>
  );

  const daysLeft =
    rfp.deadline === null
      ? null
      : Math.ceil((Date.parse(rfp.deadline) - now) / 86_400_000);
  // The status control lists the stages, plus "On hold" while it is open.
  const status = rfp.heldAt && rfpIsOpen(rfp) ? "on_hold" : rfp.stage;
  const latest = rfp.summaries[0] ?? null;

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
        aria-label={name}
        ref={sheet}
      >
        <header className="top">
          <label className={"rb-status " + columnTone[column]}>
            <span className="sr">Status</span>
            <select
              value={status}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "on_hold")
                  work("hold-rfp", {
                    areaId: rfp.id,
                    held: true,
                    reason: rfp.holdReason ?? "",
                  });
                else onMove(next as RfpStage);
              }}
            >
              <option value="received">New</option>
              <option value="in_response">In progress</option>
              <option value="submitted">In progress · submitted</option>
              {rfpIsOpen(rfp) && <option value="on_hold">On hold</option>}
              <option value="won">Won</option>
              <option
                value="handed_to_delivery"
                disabled={!rfp.deliveryProjectId}
              >
                {rfpStageLabels.handed_to_delivery}
              </option>
              <option value="lost">Lost</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
            <Icon name="chevron" width={11} height={11} aria-hidden />
          </label>
          <span className="tag">{rfp.client || "Client not set"}</span>
          <span className="grow" />
          <button
            className="btn"
            onClick={() => {
              onClose();
              onWork(rfp.id);
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
        <h2 className="title">{name}</h2>

        <div className="rb-tabs" role="tablist" aria-label="RFP sections">
          {(
            [
              ["details", "Details", null],
              ["summary", "Summary", rfp.summaries.length],
              ["team", "Team", people.length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
              {count !== null && <span className="n">{count}</span>}
            </button>
          ))}
        </div>

        {tab === "details" && (
          <div className="rb-sheet-body" role="tabpanel" aria-label="Details">
            <label className="rb-fact block">
              <span>Requirements</span>
              <textarea
                rows={2}
                defaultValue={rfp.requirements}
                key={"requirements" + rfp.requirements}
                placeholder="No requirements captured yet."
                maxLength={8000}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next !== rfp.requirements) patch({ requirements: next });
                }}
              />
            </label>
            <div className="rb-facts">
              {date(
                "Submission deadline",
                rfp.deadline,
                (deadline) => save({ deadline }),
                daysLeft === null || !rfpIsOpen(rfp)
                  ? undefined
                  : daysLeft < 0
                    ? `${-daysLeft} days overdue`
                    : daysLeft === 0
                      ? "today"
                      : `in ${daysLeft} days`,
              )}
              {date("Received", rfp.receivedAt, (receivedAt) =>
                patch({ receivedAt }),
              )}
              {date(
                "Clarifications by",
                rfp.clarificationsBy,
                (clarificationsBy) => patch({ clarificationsBy }),
              )}
              <label className="rb-fact">
                <span>Estimated value (AED)</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  defaultValue={rfp.value ?? ""}
                  key={"value" + (rfp.value ?? "")}
                  placeholder="—"
                  onBlur={(event) => {
                    const typed = event.target.value.trim();
                    const next = typed === "" ? null : Number(typed);
                    if (next !== null && !(next >= 0)) return;
                    if (next !== rfp.value) patch({ value: next });
                  }}
                />
                {rfp.value !== null && (
                  <span className="under">{rfpMoney(rfp.value)}</span>
                )}
              </label>
              {words("Source", rfp.source, (source) => patch({ source }))}
              {words("Lead", rfp.responseOwner, (responseOwner) =>
                save({ responseOwner }),
              )}
              {words("Client", rfp.client || null, (client) =>
                save({ client: client ?? "" }),
              )}
              {words(
                "Sales or account owner",
                rfp.accountOwner,
                (accountOwner) => save({ accountOwner }),
              )}
              {words("Pre-sales contact", rfp.presales, (presales) =>
                save({ presales }),
              )}
              {words("Next step", rfp.nextStep, (nextStep) =>
                patch({ nextStep }),
              )}
              {date("Next step by", rfp.nextStepAt, (nextStepAt) =>
                patch({ nextStepAt }),
              )}
            </div>

            {status === "on_hold" && (
              <div className="rb-hold">
                <label className="rb-fact block">
                  <span>Why it is on hold</span>
                  <input
                    type="text"
                    defaultValue={rfp.holdReason ?? ""}
                    key={"hold" + (rfp.holdReason ?? "")}
                    placeholder="For example: waiting for the client to share data samples"
                    maxLength={400}
                    onBlur={(event) => {
                      const reason = event.target.value.trim();
                      if (reason !== (rfp.holdReason ?? ""))
                        work("hold-rfp", {
                          areaId: rfp.id,
                          held: true,
                          reason,
                        });
                    }}
                  />
                </label>
                <button
                  className="btn"
                  onClick={() =>
                    work("hold-rfp", { areaId: rfp.id, held: false })
                  }
                >
                  Take off hold
                </button>
              </div>
            )}
            {rfp.stage === "lost" && (
              <label className="rb-fact block">
                <span>Loss reason, if known</span>
                <input
                  type="text"
                  defaultValue={rfp.lossReason ?? ""}
                  key={"loss" + (rfp.lossReason ?? "")}
                  maxLength={400}
                  onBlur={(event) => {
                    const lossReason = event.target.value.trim() || null;
                    if (lossReason !== rfp.lossReason)
                      work("move-rfp", {
                        areaId: rfp.id,
                        stage: "lost",
                        lossReason,
                      });
                  }}
                />
              </label>
            )}
            {(rfp.stage === "won" || rfp.stage === "handed_to_delivery") && (
              <div className="rb-handoff">
                <label className="row">
                  <input
                    type="checkbox"
                    checked={rfp.proposalSigned}
                    onChange={(event) =>
                      work("rfp-readiness", {
                        areaId: rfp.id,
                        proposalSigned: event.target.checked,
                        brdApproved: rfp.brdApproved,
                      })
                    }
                  />
                  Proposal signed
                </label>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={rfp.brdApproved}
                    onChange={(event) =>
                      work("rfp-readiness", {
                        areaId: rfp.id,
                        proposalSigned: rfp.proposalSigned,
                        brdApproved: event.target.checked,
                      })
                    }
                  />
                  BRD approved
                </label>
                {handoff.step === "reuse" ? (
                  <button
                    className="btn"
                    onClick={() => {
                      onClose();
                      onWork(handoff.projectId);
                    }}
                  >
                    Open delivery project
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    disabled={handoff.step !== "create"}
                    onClick={() => onMove("handed_to_delivery")}
                  >
                    Hand to delivery
                  </button>
                )}
                {handoff.step === "wait" && (
                  <span className="muted small">
                    {handoff.pending === "signature"
                      ? "Waiting for the signed proposal."
                      : "Waiting for the approved BRD."}
                  </span>
                )}
              </div>
            )}

            {latest && (
              <div className="rb-latest">
                <span className="muted small">
                  Latest summary ·{" "}
                  {new Date(latest.createdAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <p>{latest.text}</p>
              </div>
            )}
          </div>
        )}

        {tab === "summary" && (
          <div className="rb-sheet-body" role="tabpanel" aria-label="Summary">
            <form
              className="rb-add"
              onSubmit={(event) => {
                event.preventDefault();
                const field = event.currentTarget.elements.namedItem(
                  "summary",
                ) as HTMLTextAreaElement;
                const text = field.value.trim();
                if (!text) return;
                work("add-rfp-summary", { areaId: rfp.id, text });
                field.value = "";
              }}
            >
              <textarea
                name="summary"
                rows={2}
                maxLength={4000}
                aria-label="New summary"
                placeholder="Where this RFP stands, what changed, and what needs attention."
              />
              <button className="btn primary" type="submit">
                Add summary
              </button>
            </form>
            {rfp.summaries.length ? (
              <ol className="rb-notes">
                {rfp.summaries.map((item) => (
                  <li key={item.id}>
                    <span className="muted small">
                      {new Date(item.createdAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <p>{item.text}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No summaries yet.</p>
            )}
          </div>
        )}

        {tab === "team" && (
          <div className="rb-sheet-body" role="tabpanel" aria-label="Team">
            {people.length ? (
              <ul className="rb-people">
                {people.map((person, index) => {
                  const role =
                    person === rfp.responseOwner
                      ? "Lead"
                      : person === rfp.accountOwner
                        ? "Sales or account owner"
                        : person === rfp.presales
                          ? "Pre-sales contact"
                          : null;
                  return (
                    <li key={person}>
                      <span className={"rb-face f" + (index % 4)} aria-hidden>
                        {initials(person)}
                      </span>
                      <span className="who">{person}</span>
                      {role ? (
                        <span className="muted small">{role}</span>
                      ) : (
                        <button
                          className="link small"
                          aria-label={`Remove ${person} from the bid`}
                          onClick={() =>
                            patch({
                              team: rfp.team.filter((item) => item !== person),
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">Nobody is on this bid yet.</p>
            )}
            <form
              className="rb-add inline"
              onSubmit={(event) => {
                event.preventDefault();
                const field = event.currentTarget.elements.namedItem(
                  "person",
                ) as HTMLInputElement;
                const person = field.value.trim();
                if (!person || people.includes(person)) return;
                patch({ team: [...rfp.team, person] });
                field.value = "";
              }}
            >
              <input
                type="text"
                name="person"
                maxLength={200}
                aria-label="Add a person to the bid"
                placeholder="Add a person, by name or role"
              />
              <button className="btn" type="submit">
                Add
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
