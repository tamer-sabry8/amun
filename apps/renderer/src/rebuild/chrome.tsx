// Shell chrome: sidebar with six tiles, the Island, and the command palette.
import { useEffect, useRef, useState } from "react";
import {
  islandFloatMs,
  islandPresentation,
  islandWriteOwn,
  tiles,
  type Route,
} from "../../../../packages/domain/src/work/shell.ts";
import type { Attention } from "../../../../packages/domain/src/work/home.ts";
import { Icon } from "../icons.tsx";
import type { Snapshot } from "./view-model.ts";

const islandAction: Record<Attention["kind"], string | null> = {
  approval: "Review changes",
  offer: "Yes, draft it",
  result: "View findings",
  failure: "See what happened",
  risk: "Review impact",
  linking: "Choose where it belongs",
  question: null,
};
const kindLabel: Record<Attention["kind"], string> = {
  approval: "Needs your approval",
  offer: "Offer",
  result: "Ready for you",
  failure: "Something failed",
  risk: "At risk",
  linking: "Needs linking",
  question: "Question",
};

export interface IslandActions {
  onOpen(item: Attention): void;
  onPrimary(item: Attention): void;
  onAnswer(item: Attention, answer: string): void;
}

function IslandCard({
  item,
  count,
  options,
  floating,
  actions,
}: {
  item: Attention;
  count: number;
  options: string[];
  floating: boolean;
  actions: IslandActions;
}) {
  const [writing, setWriting] = useState(false);
  const [answer, setAnswer] = useState("");
  useEffect(() => {
    setWriting(false);
    setAnswer("");
  }, [item.id]);
  const primary = islandAction[item.kind];
  return (
    <section
      className={"rb-island" + (floating ? " floating" : "")}
      aria-label="Needs you"
    >
      <div className="head">
        <span>{kindLabel[item.kind]}</span>
        {item.workAreaName && <span>· {item.workAreaName}</span>}
        <span className="grow" />
        {count > 1 && (
          <span className="count" title={`${count} items need you`}>
            {count}
          </span>
        )}
      </div>
      <button
        className="title"
        style={{ justifyContent: "flex-start", textAlign: "left" }}
        onClick={() => actions.onOpen(item)}
      >
        {item.title}
      </button>
      {writing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (answer.trim()) actions.onAnswer(item, answer.trim());
          }}
          style={{ display: "grid", gap: 8 }}
        >
          <label className="sr-only" htmlFor="rb-island-answer">
            Your response
          </label>
          <textarea
            id="rb-island-answer"
            autoFocus
            value={answer}
            maxLength={4000}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <div className="row">
            <button className="btn primary grow" disabled={!answer.trim()}>
              Send
            </button>
            <button
              type="button"
              className="btn quiet"
              onClick={() => setWriting(false)}
            >
              Back
            </button>
          </div>
        </form>
      ) : (
        <>
          {item.kind === "question" &&
            options.slice(0, 3).map((option) => (
              <button
                key={option}
                className="btn"
                onClick={() => actions.onAnswer(item, option)}
              >
                {option}
              </button>
            ))}
          {primary && (
            <button
              className="btn primary"
              onClick={() => actions.onPrimary(item)}
            >
              {primary}
            </button>
          )}
          {item.kind === "question" && (
            <button className="btn quiet" onClick={() => setWriting(true)}>
              {islandWriteOwn}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function Island({
  top,
  count,
  options,
  collapsed,
  actions,
}: {
  top: Attention | null;
  count: number;
  options: string[];
  collapsed: boolean;
  actions: IslandActions;
}) {
  const [arrivedAt, setArrivedAt] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<string | null>(top?.id ?? null);
  useEffect(() => {
    if (top && top.id !== seen.current) {
      setArrivedAt(Date.now());
      setNow(Date.now());
      const timer = setTimeout(() => setNow(Date.now()), islandFloatMs + 50);
      seen.current = top.id;
      return () => clearTimeout(timer);
    }
    seen.current = top?.id ?? null;
  }, [top?.id]);
  if (!top)
    return collapsed ? null : (
      <div className="rb-island empty">Nothing needs you right now.</div>
    );
  const view = islandPresentation({
    collapsed,
    newItemAt: arrivedAt,
    now,
    hovered,
    reducedMotion:
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  if (view.mode === "card")
    return (
      <IslandCard
        item={top}
        count={count}
        options={options}
        floating={false}
        actions={actions}
      />
    );
  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        className="rb-island-badge"
        aria-label={`${count} ${count === 1 ? "item needs" : "items need"} you`}
        aria-expanded={view.mode === "floating"}
        onClick={() => setHovered((value) => !value)}
      >
        <Icon name="requests" />
        <span className="count">{count}</span>
      </button>
      {view.mode === "floating" && (
        // Never takes focus: it is announced politely and waits to be opened.
        <div aria-live="polite">
          <IslandCard
            item={top}
            count={count}
            options={options}
            floating
            actions={actions}
          />
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  route,
  collapsed,
  onRoute,
  onSearch,
  onToggle,
  island,
}: {
  route: Route;
  collapsed: boolean;
  onRoute(route: Exclude<Route, "work" | "setup">): void;
  onSearch(): void;
  onToggle(): void;
  island: React.ReactNode;
}) {
  const item = (id: Exclude<Route, "work" | "setup">, label: string) => (
    <button
      key={id}
      className="rb-nav"
      aria-current={route === id ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      onClick={() => onRoute(id)}
    >
      <Icon name={id} width={18} height={18} />
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="rb-side" aria-label="Amun">
      <div className="rb-brand">
        <span className="rb-mark" aria-hidden="true">
          A
        </span>
        <strong>Amun</strong>
      </div>
      {item("home", "Home")}
      <button
        className="rb-nav"
        onClick={onSearch}
        aria-label={collapsed ? "Search" : undefined}
        title={collapsed ? "Search" : undefined}
      >
        <Icon name="search" width={18} height={18} />
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="rb-sep" />
      {tiles.map(([id, label]) => item(id, label))}
      <div className="spacer" />
      {island}
      <div className="rb-user">
        <span className="avatar" aria-hidden="true">
          Y
        </span>
        <span className="grow">You</span>
        <button
          className="icon-btn"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title="⌘\"
          onClick={onToggle}
        >
          <Icon name="sidebar" width={18} height={18} />
        </button>
        <button
          className="icon-btn"
          aria-label="Settings"
          aria-current={route === "settings" ? "page" : undefined}
          onClick={() => onRoute("settings")}
        >
          <Icon name="settings" width={18} height={18} />
        </button>
      </div>
    </nav>
  );
}

export function Palette({
  open,
  snapshot,
  onClose,
  onRoute,
  onWork,
  onBrowser,
}: {
  open: boolean;
  snapshot: Snapshot;
  onClose(): void;
  onRoute(route: Exclude<Route, "work" | "setup">): void;
  onWork(areaId: string): void;
  /** Null outside a work session, where there is nowhere to show it. */
  onBrowser: (() => void) | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open && !dialog.current?.open) {
      setQuery("");
      dialog.current?.showModal();
    } else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  const q = query.trim().toLowerCase();
  const hit = (text: string) => !q || text.toLowerCase().includes(q);
  const places: [Exclude<Route, "work" | "setup">, string][] = [
    ["home", "Home"],
    ...tiles.map(([id, label]) => [id, label] as [typeof id, string]),
    ["settings", "Settings"],
  ];
  const active = snapshot.setup.activeGroupId;
  const areas = snapshot.areas.filter(
    (area) =>
      (!active || !area.groupId || area.groupId === active) && hit(area.name),
  );
  const records = q
    ? snapshot.library.filter(
        (item) =>
          (!active || !item.groupId || item.groupId === active) &&
          hit(item.title),
      )
    : [];
  return (
    <dialog
      className="rb-palette"
      ref={dialog}
      aria-label="Search"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <input
        autoFocus
        aria-label="Search work, records and places"
        placeholder="Search work, records and places…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="results">
        {areas.slice(0, 8).map((area) => (
          <button key={area.id} onClick={() => onWork(area.id)}>
            <Icon name="portfolio" width={16} height={16} />
            {area.name}
          </button>
        ))}
        {records.slice(0, 6).map((item) => (
          <button
            key={item.id}
            onClick={() =>
              item.workAreaIds[0]
                ? onWork(item.workAreaIds[0])
                : onRoute("home")
            }
          >
            <Icon name="library" width={16} height={16} />
            {item.title}
          </button>
        ))}
        {places
          .filter(([, label]) => hit(label))
          .map(([id, label]) => (
            <button key={id} onClick={() => onRoute(id)}>
              <Icon name={id} width={16} height={16} />
              {label}
            </button>
          ))}
        {onBrowser && hit("Open browser") && (
          <button onClick={onBrowser}>
            <Icon name="browser" width={16} height={16} />
            Open browser
          </button>
        )}
        {!areas.length && !records.length && q && (
          <p className="muted" style={{ padding: "10px 12px" }}>
            Nothing matches “{query}” in this group.
          </p>
        )}
      </div>
    </dialog>
  );
}
