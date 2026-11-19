// Shell chrome: sidebar with six tiles, the Island, and the command palette.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  islandFloatMs,
  islandPresentation,
  islandWriteOwn,
  tiles,
  type Route,
} from "../../../../packages/domain/src/work/shell.ts";
import type { Attention } from "../../../../packages/domain/src/work/home.ts";
import { FirstmateMark } from "./firstmate-mark.tsx";
import { Icon } from "../icons.tsx";
import { bridge } from "../bridge.ts";
import {
  contentSearchResult,
  type ContentSearchHit,
} from "../../../../packages/contracts/src/work.ts";
import type { Snapshot } from "./view-model.ts";
import { clockLabel } from "./what-happened.tsx";
import {
  chatLimit,
  folderLimit,
  workFolders,
  type WorkFolder,
} from "./folders.ts";

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

/** Where an item stands, in three steps. Only what is known is claimed. */
const islandSteps: Partial<
  Record<Attention["kind"], [string, string, string]>
> = {
  approval: ["Drafted", "Review", "Publish"],
  result: ["Asked", "Worked", "Read"],
  offer: ["Noticed", "You decide", "Draft"],
  risk: ["Spotted", "Review", "Resolve"],
};
const islandFoot: Partial<Record<Attention["kind"], string>> = {
  approval: "Nothing is published until you approve",
  offer: "Drafts only · nothing is sent",
  risk: "Your teammate’s change is left in place",
};
const waitingLine = (count: number) =>
  `${count} more ${count === 1 ? "thing is" : "things are"} waiting`;

function IslandCard({
  item,
  count,
  options,
  floating,
  actions,
  onMinimise,
}: {
  item: Attention;
  count: number;
  options: string[];
  floating: boolean;
  actions: IslandActions;
  onMinimise?: (() => void) | undefined;
}) {
  const [writing, setWriting] = useState(false);
  const [answer, setAnswer] = useState("");
  useEffect(() => {
    setWriting(false);
    setAnswer("");
  }, [item.id]);
  const primary = islandAction[item.kind];
  const steps = islandSteps[item.kind];
  return (
    <section
      className={"rb-island" + (floating ? " floating" : "")}
      aria-label="Needs you"
    >
      <div className="head">
        <FirstmateMark mood={item.kind === "result" ? "done" : "needs"} />
        <span className="who">
          <strong>Firstmate</strong>
          <span className={"state " + item.kind}>{kindLabel[item.kind]}</span>
        </span>
        {count > 1 && (
          <span className="count" title={`${count} items need you`}>
            {count}
          </span>
        )}
        {onMinimise && (
          <button
            className="icon-btn"
            aria-label="Minimise"
            onClick={onMinimise}
          >
            <Icon name="chevron" width={14} height={14} />
          </button>
        )}
      </div>
      <button
        className="title"
        style={{ justifyContent: "flex-start", textAlign: "left" }}
        onClick={() => actions.onOpen(item)}
      >
        {item.title}
      </button>
      {item.kind === "failure" && item.detail && (
        // What failed, in words, not only that something did.
        <p className="detail">{item.detail}</p>
      )}
      {steps && (
        <ol className="steps" aria-label="Progress">
          {steps.map((step, position) => (
            <li
              key={step}
              className={
                position === 0 ? "done" : position === 1 ? "now" : "next"
              }
            >
              <span className="dot" aria-hidden="true">
                {position === 0 && (
                  <Icon name="check" width={10} height={10} strokeWidth={3} />
                )}
              </span>
              {step}
            </li>
          ))}
        </ol>
      )}
      {(item.workAreaName || item.batch || count > 1) && (
        <ul className="facts">
          {item.batch && (
            <li className="good">
              {item.batch.count}{" "}
              {item.batch.count === 1
                ? item.batch.noun
                : item.batch.noun.endsWith("y")
                  ? item.batch.noun.slice(0, -1) + "ies"
                  : item.batch.noun + "s"}{" "}
              ready for your review
            </li>
          )}
          {item.workAreaName && <li>In {item.workAreaName}</li>}
          {count > 1 && <li className="warn">{waitingLine(count - 1)}</li>}
        </ul>
      )}
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
      {islandFoot[item.kind] && <p className="foot">{islandFoot[item.kind]}</p>}
    </section>
  );
}

const minimisedKey = "amun.island.minimised";
export function Island({
  top,
  count,
  held = 0,
  options,
  collapsed,
  actions,
}: {
  top: Attention | null;
  count: number;
  /** Things left out because the open chat is already asking about them. */
  held?: number;
  options: string[];
  collapsed: boolean;
  actions: IslandActions;
}) {
  const [arrivedAt, setArrivedAt] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [minimised, setMinimised] = useState(() => {
    try {
      return localStorage.getItem(minimisedKey) === "1";
    } catch {
      return false;
    }
  });
  const minimise = (value: boolean) => {
    setMinimised(value);
    try {
      localStorage.setItem(minimisedKey, value ? "1" : "0");
    } catch {
      // Remembering this is a convenience only.
    }
  };
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
    // Saying "nothing needs you" beside a chat that is asking would be wrong.
    return collapsed || held > 0 ? null : (
      <div className="rb-island empty">
        <FirstmateMark size={28} />
        <span>Nothing needs you right now.</span>
      </div>
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
  const needs = `Firstmate · ${count} ${count === 1 ? "thing needs" : "things need"} you`;
  if (view.mode === "card" && !minimised)
    return (
      <IslandCard
        item={top}
        count={count}
        options={options}
        floating={false}
        actions={actions}
        onMinimise={() => minimise(true)}
      />
    );
  if (view.mode === "card")
    // Minimised in the open sidebar: one line that opens the card again.
    return (
      <button
        className="rb-island-line"
        aria-label={needs}
        aria-expanded={false}
        onClick={() => minimise(false)}
      >
        <FirstmateMark size={28} mood="needs" />
        <span className="text">
          <strong>Firstmate</strong>
          <span>{kindLabel[top.kind]}</span>
        </span>
        <span className="count">{count}</span>
        <Icon name="chevron" width={14} height={14} />
      </button>
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
        title={needs}
        onClick={() => setHovered((value) => !value)}
      >
        <FirstmateMark size={30} mood="needs" />
        <span className="count">{count}</span>
        <Icon name="chevron" width={12} height={12} />
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
  snapshot,
  open,
  onChat,
}: {
  route: Route;
  collapsed: boolean;
  onRoute(route: Exclude<Route, "work" | "setup">): void;
  onSearch(): void;
  onToggle(): void;
  island: React.ReactNode;
  snapshot: Snapshot;
  /** The chat on screen, when a piece of work is open. */
  open: { areaId: string; chatId: string | null } | null;
  onChat(areaId: string, chatId: string | null): void;
}) {
  const { folders, general } = workFolders(
    snapshot.areas,
    snapshot.chats,
    snapshot.setup.activeGroupId,
  );
  // Folders the owner opened or closed by hand; the open work's is open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [allChats, setAllChats] = useState<Record<string, boolean>>({});
  const folder = (item: WorkFolder, name = item.name) => {
    const current = open?.areaId === item.areaId;
    const expanded = toggled[item.areaId] ?? current;
    const chats = allChats[item.areaId]
      ? item.chats
      : item.chats.slice(0, chatLimit);
    return (
      <li key={item.areaId}>
        <button
          className="folder"
          aria-expanded={expanded}
          onClick={() => {
            setToggled({ ...toggled, [item.areaId]: !expanded });
            if (!current) onChat(item.areaId, null);
          }}
        >
          <Icon
            name="chevron"
            width={11}
            height={11}
            style={{ rotate: expanded ? "90deg" : undefined }}
          />
          <span>{name}</span>
        </button>
        {expanded && (
          <ul>
            {chats.map((chat) => (
              <li key={chat.chatId ?? "main"}>
                <button
                  className="chat"
                  aria-current={
                    current && open.chatId === chat.chatId ? "page" : undefined
                  }
                  title={chat.title}
                  onClick={() => onChat(item.areaId, chat.chatId)}
                >
                  {chat.title}
                </button>
              </li>
            ))}
            {item.chats.length > chats.length && (
              <li>
                <button
                  className="chat more"
                  onClick={() =>
                    setAllChats({ ...allChats, [item.areaId]: true })
                  }
                >
                  See more
                </button>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };
  // Icon tiles; the name stays in the button for assistive technology and
  // shows as a tooltip.
  const item = (id: Exclude<Route, "work" | "setup">, label: string) => (
    <button
      key={id}
      className="rb-nav"
      aria-current={route === id ? "page" : undefined}
      aria-label={label}
      title={label}
      onClick={() => onRoute(id)}
    >
      <Icon name={id} width={20} height={20} />
    </button>
  );
  return (
    <nav className="rb-side" aria-label="Amun">
      <div className="rb-brand">
        <span className="rb-mark" aria-hidden="true" />
        <strong>Amun</strong>
      </div>
      <div className="rb-tiles">
        {item("home", "Home")}
        <button
          className="rb-nav"
          onClick={onSearch}
          aria-label="Search"
          title="Search  ⌘K"
        >
          <Icon name="search" width={20} height={20} />
        </button>
        {tiles.map(([id, label]) => item(id, label))}
      </div>
      {/* Takes only the room between the tiles and Firstmate's card, and
          scrolls inside it, so the card always keeps its place. */}
      <div className="rb-folders" aria-label="Your work and its chats">
        <ul>
          {folders.slice(0, folderLimit).map((item) => folder(item))}
          {folders.length > folderLimit && (
            <li>
              <button
                className="chat more"
                onClick={() => onRoute("portfolio")}
              >
                See all
              </button>
            </li>
          )}
          {general.map((item) => folder(item, "General"))}
        </ul>
      </div>
      {island}
      <div className="rb-user">
        <span className="avatar" aria-hidden="true" title="You">
          Y
        </span>
        <span className="grow" />
        <button
          className="rb-nav small"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title="⌘\\"
          onClick={onToggle}
        >
          <Icon name="sidebar" width={18} height={18} />
        </button>
        <button
          className="rb-nav small"
          aria-label="Settings"
          title="Settings"
          aria-current={route === "settings" ? "page" : undefined}
          onClick={() => onRoute("settings")}
        >
          <Icon name="settings" width={18} height={18} />
        </button>
      </div>
    </nav>
  );
}

export type ContentHit = ContentSearchHit;

export function Palette({
  open,
  snapshot,
  onClose,
  onRoute,
  onWork,
  onBrowser,
  onHit,
}: {
  open: boolean;
  snapshot: Snapshot;
  onClose(): void;
  onRoute(route: Exclude<Route, "work" | "setup">): void;
  onWork(areaId: string): void;
  /** Null outside a work session, where there is nowhere to show it. */
  onBrowser: (() => void) | null;
  onHit(hit: ContentHit): void;
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
  const [found, setFound] = useState<{ q: string; hits: ContentHit[] }>({
    q: "",
    hits: [],
  });
  // Searches the words inside documents, records and conversations. The
  // service limits it to the group being worked in.
  useEffect(() => {
    if (!open || q.length < 2) return;
    const requestId = crypto.randomUUID();
    const stop = bridge.onEvent((raw) => {
      const event = contentSearchResult.safeParse(raw);
      if (event.success && event.data.requestId === requestId)
        setFound({ q, hits: event.data.hits });
    });
    const timer = setTimeout(
      () =>
        bridge.send({ version: 1, kind: "content-search", requestId, query }),
      150,
    );
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [open, q, query]);
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
  const shown = new Set([
    ...records.slice(0, 6).map((item) => item.id),
    ...areas.slice(0, 8).map((area) => area.id),
  ]);
  const inside = found.q === q && q.length >= 2 ? found.hits : [];
  const contentHits = inside.filter((item) => !shown.has(item.id));
  const said = contentHits
    .filter((item) => item.kind === "message")
    .slice(0, 4);
  const did = contentHits.filter((item) => item.kind === "step").slice(0, 4);
  const texts = contentHits
    .filter((item) => item.kind === "document" || item.kind === "record")
    .slice(0, 6);
  const areaName = (id: string | null) =>
    snapshot.areas.find((area) => area.id === id)?.name ?? "";
  const hitRow = (item: ContentHit, title: string, line: ReactNode) => (
    <button key={item.kind + item.id} onClick={() => onHit(item)}>
      <Icon
        name={item.kind === "document" ? "library" : "decisions"}
        width={16}
        height={16}
      />
      <span style={{ minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "block" }}>{title}</span>
        <span className="muted small" style={{ display: "block" }}>
          {line}
        </span>
      </span>
    </button>
  );
  const marked = (item: ContentHit) =>
    item.snippet.map((part, index) =>
      part.match ? <strong key={index}>{part.text}</strong> : part.text,
    );
  const joined = (parts: (string | null | undefined)[]) =>
    parts.filter(Boolean).join(" · ");
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
        {said.length > 0 && <h3>In conversations</h3>}
        {said.map((item) =>
          hitRow(
            item,
            joined([
              item.title,
              item.role === "you" ? "You" : "Firstmate",
              item.at ? clockLabel(item.at) : null,
            ]),
            marked(item),
          ),
        )}
        {did.length > 0 && <h3>In what Firstmate did</h3>}
        {did.map((item) =>
          hitRow(
            item,
            "Firstmate " + item.title,
            joined([
              areaName(item.workAreaId),
              item.at ? clockLabel(item.at) : null,
              item.script,
            ]),
          ),
        )}
        {texts.length > 0 && (said.length > 0 || did.length > 0) && (
          <h3>Documents</h3>
        )}
        {texts.map((item) => hitRow(item, item.title, marked(item)))}
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
        {!areas.length && !records.length && !contentHits.length && q && (
          <p className="muted" style={{ padding: "10px 12px" }}>
            Nothing matches “{query}” in this group.
          </p>
        )}
      </div>
    </dialog>
  );
}
