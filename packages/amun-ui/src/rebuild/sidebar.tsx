// The sidebar (owner's chat handoff, approved 20 November 2026): tiles, New
// chat beside Search chats, one of three views of the chats, Firstmate's card,
// and the three-dot switcher (Recent, Folders, General). The list takes only
// the room between the top and Firstmate's card and scrolls inside it, with
// no row cap. Switching views never changes the open chat or its draft.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  tiles,
  type Route,
} from "../../../../packages/domain/src/work/shell.ts";
import {
  chatLists,
  pinOrderAt,
  type ChatEntry,
  type FolderEntry,
} from "../../../../packages/domain/src/work/chat-lists.ts";
import { generalConversationName } from "../../../../packages/domain/src/work/model.ts";
import { Icon } from "../icons.tsx";
import { work } from "./store.ts";
import type { Snapshot } from "./view-model.ts";
import {
  folderDraftKey,
  setView,
  sidebarViewName,
  sidebarViews,
  useChatMemory,
  useWriting,
  type SidebarView,
} from "./chat-memory.ts";

/** The chat each folder showed under it during this run of Amun. */
const visited = new Map<string, string>();

export function Sidebar({
  route,
  collapsed,
  onRoute,
  onSearch,
  onSearchChats,
  onToggle,
  island,
  snapshot,
  open,
  onChat,
  onNewChat,
  onMoveChat,
}: {
  route: Route;
  collapsed: boolean;
  onRoute(route: Exclude<Route, "work" | "setup">): void;
  /** The ⌘K palette. */
  onSearch(): void;
  /** Search across chat messages. */
  onSearchChats(): void;
  onToggle(): void;
  island: ReactNode;
  snapshot: Snapshot;
  /** The chat on screen, when a piece of work is open. */
  open: { areaId: string; chatId: string | null } | null;
  onChat(areaId: string, chatId: string | null): void;
  /** "+" on a folder, or (null) the global New chat. */
  onNewChat(areaId: string | null): void;
  /** "Move to another folder" on a chat. */
  onMoveChat(areaId: string, chatId: string | null, toAreaId: string): void;
}) {
  const memory = useChatMemory();
  const writing = useWriting();
  const view = memory.view;
  const lists = chatLists(
    snapshot.areas,
    snapshot.chats,
    snapshot.messages,
    snapshot.setup.activeGroupId,
    generalConversationName,
  );
  const openKey = open ? `${open.areaId}:${open.chatId ?? "first"}` : null;
  // The open chat stays under its folder for the rest of this visit.
  if (open && openKey && lists.byKey.get(openKey)?.folder)
    visited.set(open.areaId, openKey);
  // Folders listed in full by a click on their name.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [archivedShown, setArchivedShown] = useState<Record<string, boolean>>(
    {},
  );
  const [menu, setMenu] = useState<{
    key: string;
    top: number;
    left: number;
    step: "menu" | "confirm" | "move";
  } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [hint, setHint] = useState<SidebarView | null>(null);
  // The folder whose chats show in the panel beside the sidebar.
  const [hover, setHover] = useState<{
    areaId: string;
    top: number;
    left: number;
    viaKeys: boolean;
  } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!reveal) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-key="${CSS.escape(reveal)}"]`,
    );
    const list = listRef.current;
    if (row && list) {
      // Only the list scrolls; the window around it never moves.
      const top =
        row.getBoundingClientRect().top - list.getBoundingClientRect().top;
      if (top < 0) list.scrollTop += top - 8;
      else if (top + row.offsetHeight > list.clientHeight)
        list.scrollTop += top + row.offsetHeight - list.clientHeight + 8;
    }
    row?.focus({ preventScroll: true });
    setReveal(null);
  }, [reveal, view]);

  const later = (fn: () => void, ms: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(fn, ms);
  };
  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );
  const showPanel = (
    areaId: string,
    row: HTMLElement,
    viaKeys: boolean,
    delay: number,
  ) => {
    const box = row.getBoundingClientRect();
    const side = row.closest(".rb-side")?.getBoundingClientRect();
    later(
      () =>
        setHover({
          areaId,
          top: box.top - 6,
          left: (side?.right ?? box.right) + 6,
          viaKeys,
        }),
      delay,
    );
  };
  const hidePanel = () => later(() => setHover(null), 180);
  const keepPanel = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  };

  const openMenu = (key: string, button: HTMLElement) => {
    const box = button.getBoundingClientRect();
    setMenu(
      menu?.key === key
        ? null
        : { key, top: box.bottom + 4, left: box.left, step: "menu" },
    );
  };
  const dots = (key: string, label: string) => (
    <button
      className="dots"
      aria-label={`More for ${label}`}
      aria-haspopup="menu"
      aria-expanded={menu?.key === key}
      onClick={(event) => {
        event.stopPropagation();
        openMenu(key, event.currentTarget);
      }}
    >
      <Icon name="more" width={16} height={16} />
    </button>
  );
  const popup = (key: string, items: ReactNode) =>
    menu?.key === key && (
      <>
        <div className="rb-folder-veil" onClick={() => setMenu(null)} />
        <div
          className="rb-menu rb-folder-menu"
          role="menu"
          style={{ top: menu.top, left: menu.left }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenu(null);
          }}
        >
          {items}
        </div>
      </>
    );
  const rename = (value: string, save: (next: string) => void) => (
    <form
      className="rename"
      onSubmit={(event) => {
        event.preventDefault();
        const next = new FormData(event.currentTarget).get("name");
        if (typeof next === "string" && next.trim()) save(next.trim());
        setRenaming(null);
      }}
    >
      <input
        name="name"
        type="text"
        aria-label="Name"
        autoFocus
        maxLength={200}
        defaultValue={value}
        onBlur={() => setRenaming(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setRenaming(null);
        }}
      />
    </form>
  );

  const pinned = lists.recent.filter((item) => item.pinOrder !== null);
  const folderAreas = lists.folders;
  const choose = (item: ChatEntry) => {
    setHover(null);
    onChat(item.areaId, item.chatId);
  };
  /** "Gitex" on a Recent row: show the chat under its folder. */
  const showInFolder = (item: ChatEntry) => {
    visited.set(item.areaId, item.key);
    setView("folders");
    if (openKey !== item.key) onChat(item.areaId, item.chatId);
    setReveal(item.key);
  };

  const chatMenu = (item: ChatEntry) => {
    const elsewhere = folderAreas.filter(
      (folder) => folder.areaId !== item.areaId,
    );
    const pinIndex = pinned.findIndex((entry) => entry.key === item.key);
    const others = pinned.filter((entry) => entry.key !== item.key);
    const pinAt = (index: number) => {
      setMenu(null);
      work("pin-chat", {
        workAreaId: item.areaId,
        chatId: item.chatId,
        order: pinOrderAt(others, index),
      });
    };
    if (item.archived)
      return (
        <button
          role="menuitem"
          onClick={() => {
            setMenu(null);
            work("archive-chat", {
              workAreaId: item.areaId,
              chatId: item.chatId,
              archived: false,
            });
          }}
        >
          Bring back
        </button>
      );
    if (menu?.step === "move")
      return (
        <>
          <div className="rb-menu-title">Move this chat to</div>
          {elsewhere.map((folder) => (
            <button
              key={folder.areaId}
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onMoveChat(item.areaId, item.chatId, folder.areaId);
              }}
            >
              {folder.name}
            </button>
          ))}
        </>
      );
    return (
      <>
        <button
          role="menuitem"
          onClick={() => {
            setMenu(null);
            setRenaming(item.key);
          }}
        >
          Rename
        </button>
        {item.pinOrder === null ? (
          <button role="menuitem" onClick={() => pinAt(others.length)}>
            Pin to Recent
          </button>
        ) : (
          <>
            {pinIndex > 0 && (
              <button role="menuitem" onClick={() => pinAt(pinIndex - 1)}>
                Move pin up
              </button>
            )}
            {pinIndex >= 0 && pinIndex < pinned.length - 1 && (
              <button role="menuitem" onClick={() => pinAt(pinIndex + 1)}>
                Move pin down
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                work("pin-chat", {
                  workAreaId: item.areaId,
                  chatId: item.chatId,
                  order: null,
                });
              }}
            >
              Unpin from Recent
            </button>
          </>
        )}
        {elsewhere.length > 0 && (
          <button
            role="menuitem"
            onClick={() => setMenu({ ...menu!, step: "move" })}
          >
            Move to another folder
          </button>
        )}
        <button
          role="menuitem"
          onClick={() => {
            setMenu(null);
            work("archive-chat", {
              workAreaId: item.areaId,
              chatId: item.chatId,
              archived: true,
            });
          }}
        >
          Archive
        </button>
      </>
    );
  };

  /** One chat's row, anywhere chats are listed. */
  const chatRow = (
    item: ChatEntry,
    place: "recent" | "child" | "flat",
  ): ReactNode => (
    <li key={item.key}>
      {renaming === item.key ? (
        rename(item.title, (title) =>
          work("rename-chat", {
            workAreaId: item.areaId,
            chatId: item.chatId,
            title,
          }),
        )
      ) : (
        <div
          className={
            "line chatline" +
            (item.unread ? " unread" : "") +
            (openKey === item.key ? " current" : "")
          }
        >
          <button
            className={
              "chat" +
              (place === "child" ? "" : " flat") +
              (item.archived ? " archived" : "")
            }
            data-key={item.key}
            aria-current={openKey === item.key ? "page" : undefined}
            title={item.title}
            onClick={() => choose(item)}
          >
            {place === "recent" && item.pinOrder !== null && (
              <Icon name="pin" width={13} height={13} className="pinmark" />
            )}
            <span className="title">{item.title}</span>
            {place === "recent" && item.pinOrder !== null && (
              <span className="sr-only">, pinned</span>
            )}
            {item.unread > 0 && <span className="sr-only">, unread reply</span>}
            {writing.has(item.key) && (
              <span
                className="rb-writing"
                role="img"
                aria-label="Firstmate is writing"
              >
                <i />
                <i />
                <i />
              </span>
            )}
          </button>
          {place === "recent" && (
            <button
              className="where"
              title={`Show in ${item.folder ?? "General"}`}
              onClick={() =>
                item.folder ? showInFolder(item) : setView("general")
              }
            >
              {item.folder ?? "General"}
            </button>
          )}
          {dots(item.key, item.title)}
        </div>
      )}
      {popup(item.key, chatMenu(item))}
    </li>
  );

  const folderMenu = (item: FolderEntry) =>
    menu?.step === "confirm" ? (
      <>
        <div className="rb-menu-title">
          Delete “{item.name}”? Its chats, plans and anything waiting on it go
          with it.
        </div>
        <button
          role="menuitem"
          className="danger"
          onClick={() => {
            setMenu(null);
            work("delete-area", { areaId: item.areaId });
          }}
        >
          Delete it
        </button>
        <button role="menuitem" onClick={() => setMenu(null)}>
          Keep it
        </button>
      </>
    ) : (
      <>
        <button
          role="menuitem"
          onClick={() => {
            setMenu(null);
            const latest = item.chats[0];
            if (latest) choose(latest);
            else onNewChat(item.areaId);
          }}
        >
          Open
        </button>
        <button
          role="menuitem"
          onClick={() => {
            setMenu(null);
            setRenaming(item.areaId);
          }}
        >
          Rename
        </button>
        {item.archived.length > 0 && (
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              setExpanded({ ...expanded, [item.areaId]: true });
              setArchivedShown({
                ...archivedShown,
                [item.areaId]: !archivedShown[item.areaId],
              });
            }}
          >
            {archivedShown[item.areaId]
              ? "Hide archived chats"
              : "Archived chats"}
          </button>
        )}
        <div className="rule" />
        <button
          role="menuitem"
          className="danger"
          onClick={() => setMenu({ ...menu!, step: "confirm" })}
        >
          Delete
        </button>
      </>
    );

  const folderRow = (item: FolderEntry): ReactNode => {
    const full = !!expanded[item.areaId];
    const child = visited.get(item.areaId);
    const childEntry = child ? lists.byKey.get(child) : undefined;
    const listed = full
      ? [...item.chats, ...(archivedShown[item.areaId] ? item.archived : [])]
      : childEntry && !childEntry.archived && childEntry.areaId === item.areaId
        ? [childEntry]
        : [];
    const draft = !!memory.drafts[folderDraftKey(item.areaId)];
    const keys = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        showPanel(item.areaId, event.currentTarget, true, 0);
      } else if (event.key === "Escape") setHover(null);
    };
    return (
      <li key={item.areaId} data-folder={item.areaId}>
        {renaming === item.areaId ? (
          rename(item.name, (name) =>
            work("update-area", { areaId: item.areaId, patch: { name } }),
          )
        ) : (
          <div
            className={
              "line folderline" + (hover?.areaId === item.areaId ? " hov" : "")
            }
            onMouseEnter={(event) =>
              showPanel(item.areaId, event.currentTarget, false, 160)
            }
            onMouseLeave={hidePanel}
          >
            <button
              className="folder"
              aria-expanded={full}
              aria-haspopup="true"
              aria-keyshortcuts="ArrowRight"
              title={`${item.name}. Press right arrow to browse its chats.`}
              onClick={() => setExpanded({ ...expanded, [item.areaId]: !full })}
              onKeyDown={keys}
            >
              <Icon
                name={full ? "folderOpen" : "folder"}
                width={16}
                height={16}
              />
              <span className="title">{item.name}</span>
              {draft && (
                <Icon
                  name="compose"
                  width={13}
                  height={13}
                  className="draftmark"
                />
              )}
              {draft && <span className="sr-only">, unsent draft</span>}
              {item.unread && (
                <>
                  <i className="unreadmark" aria-hidden="true" />
                  <span className="sr-only">, unread replies</span>
                </>
              )}
            </button>
            <button
              className="dots"
              aria-label={`New chat in ${item.name}`}
              title={`New chat in ${item.name}`}
              onClick={() => onNewChat(item.areaId)}
            >
              <Icon name="plus" width={15} height={15} />
            </button>
            {dots(item.areaId, item.name)}
          </div>
        )}
        {popup(item.areaId, folderMenu(item))}
        {listed.length > 0 && (
          <ul>{listed.map((entry) => chatRow(entry, "child"))}</ul>
        )}
      </li>
    );
  };

  const panelFolder = hover
    ? folderAreas.find((item) => item.areaId === hover.areaId)
    : undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hover?.viaKeys)
      panelRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [hover?.areaId, hover?.viaKeys]);
  const panelKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>("button") ?? []),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const focusRow = () =>
      listRef.current
        ?.querySelector<HTMLElement>(
          `[data-folder="${CSS.escape(hover?.areaId ?? "")}"] .folder`,
        )
        ?.focus();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[Math.min(at + 1, buttons.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[Math.max(at - 1, 0)]?.focus();
    } else if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHover(null);
      focusRow();
    }
  };

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
  const emptyLine = (text: string) => <li className="rb-side-empty">{text}</li>;

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
      <div className="rb-newrow">
        <button className="new" onClick={() => onNewChat(null)}>
          <Icon name="compose" width={16} height={16} />
          <span>New chat</span>
        </button>
        <button
          className="dots"
          aria-label="Search chats"
          title="Search chats"
          onClick={onSearchChats}
        >
          <Icon name="search" width={16} height={16} />
        </button>
      </div>
      <div
        className="rb-folders"
        ref={listRef}
        aria-label={sidebarViewName[view]}
      >
        <ul>
          {view === "recent" &&
            (lists.recent.length
              ? lists.recent.flatMap((entry, index) => [
                  index === pinned.length && pinned.length > 0 ? (
                    <li key="pins" className="pinrule" role="separator" />
                  ) : null,
                  chatRow(entry, "recent"),
                ])
              : emptyLine("Your chats will show here, newest first."))}
          {view === "folders" &&
            (folderAreas.length
              ? folderAreas.map((entry) => folderRow(entry))
              : emptyLine(
                  "Products, projects, tasks and RFPs will show here.",
                ))}
          {view === "general" && (
            <>
              {lists.general.map((entry) => chatRow(entry, "flat"))}
              {archivedShown.general &&
                lists.generalArchived.map((entry) => chatRow(entry, "flat"))}
              {!lists.general.length &&
                emptyLine("Chats that belong to no folder show here.")}
              {lists.generalArchived.length > 0 && (
                <li>
                  <button
                    className="chat more flat"
                    onClick={() =>
                      setArchivedShown({
                        ...archivedShown,
                        general: !archivedShown.general,
                      })
                    }
                  >
                    {archivedShown.general
                      ? "Hide archived chats"
                      : "Archived chats"}
                  </button>
                </li>
              )}
            </>
          )}
        </ul>
      </div>
      {panelFolder && hover && !collapsed && (
        <div
          className="rb-folder-panel"
          ref={panelRef}
          role="menu"
          aria-label={`Chats in ${panelFolder.name}`}
          style={{
            top: Math.min(hover.top, window.innerHeight - 160),
            left: hover.left,
            maxHeight: `calc(100vh - ${Math.min(hover.top, window.innerHeight - 160) + 12}px)`,
          }}
          onMouseEnter={keepPanel}
          onMouseLeave={hidePanel}
          onKeyDown={panelKeys}
        >
          <div className="head">
            {panelFolder.name} · {panelFolder.chats.length}{" "}
            {panelFolder.chats.length === 1 ? "chat" : "chats"}
          </div>
          <button
            role="menuitem"
            className="newc"
            onClick={() => {
              setHover(null);
              onNewChat(panelFolder.areaId);
            }}
          >
            <Icon name="plus" width={14} height={14} />
            <span className="title">New chat</span>
            {memory.drafts[folderDraftKey(panelFolder.areaId)] && (
              <span className="age">draft</span>
            )}
          </button>
          <div className="scroll">
            {panelFolder.chats.map((entry) => (
              <button
                key={entry.key}
                role="menuitem"
                className={
                  (entry.unread ? "unread" : "") +
                  (openKey === entry.key ? " current" : "")
                }
                title={entry.title}
                onClick={() => choose(entry)}
              >
                <span className="title">{entry.title}</span>
                <span className="age">{shortAge(entry.sortAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {island}
      <div className="rb-user">
        <span className="avatar" aria-hidden="true" title="You">
          Y
        </span>
        <div
          className="rb-switch"
          role="tablist"
          aria-label="Chat lists"
          onKeyDown={(event) => {
            const at = sidebarViews.indexOf(view);
            const step =
              event.key === "ArrowRight"
                ? 1
                : event.key === "ArrowLeft"
                  ? -1
                  : 0;
            if (!step) return;
            event.preventDefault();
            const next = sidebarViews[(at + step + 3) % 3]!;
            setView(next);
            (
              event.currentTarget.querySelector(
                `[data-view="${next}"]`,
              ) as HTMLElement | null
            )?.focus();
          }}
        >
          {sidebarViews.map((name) => (
            <button
              key={name}
              role="tab"
              data-view={name}
              aria-selected={view === name}
              aria-label={sidebarViewName[name]}
              tabIndex={view === name ? 0 : -1}
              className="dot"
              onClick={() => setView(name)}
              onMouseEnter={() => setHint(name)}
              onMouseLeave={() => setHint(null)}
              onFocus={() => setHint(name)}
              onBlur={() => setHint(null)}
            >
              {hint === name && (
                <span className="tip" aria-hidden="true">
                  {sidebarViewName[name]}
                </span>
              )}
            </button>
          ))}
          <span className="name">{sidebarViewName[view]}</span>
        </div>
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

/** "2m", "3h", "Tue", "12 Nov": how long ago the owner last wrote. */
export function shortAge(at: string, now = Date.now()): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  const date = new Date(then);
  if (minutes < 6 * 24 * 60)
    return date.toLocaleDateString("en-GB", { weekday: "short" });
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
