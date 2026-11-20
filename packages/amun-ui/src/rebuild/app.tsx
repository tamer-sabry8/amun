// Amun shell v3 (handoff §4): sidebar · main workspace · rail. Replaces the
// earlier shell at its mount point; see docs/UX-REBUILD.md for what was
// switched off and how to restore it.
import {
  asksForNewWork,
  routeNewWork,
  generalConversationName,
} from "../../../../packages/domain/src/work/model.ts";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import {
  downloadsFloatMs,
  initialShell,
  resolveTheme,
  type ThemeId,
  shellReducer,
  sidebarCollapsed,
  type Route,
} from "../../../../packages/domain/src/work/shell.ts";
import type { Attention } from "../../../../packages/domain/src/work/home.ts";
import type { LibraryItem } from "../../../../packages/domain/src/work/planning.ts";
import { bridge, initializeBridge } from "../bridge.ts";
import { AuthPrompt } from "../auth-prompt-view.tsx";
import { Icon } from "../icons.tsx";
import "../tokens.css";
import "../shell.css";
import "./rebuild.css";
import "./motion.css";
import { Island, Palette, Sidebar, type IslandMove } from "./chrome.tsx";
import {
  chatsOf,
  latestOpenChat,
} from "../../../../packages/domain/src/work/chats.ts";
import {
  anotherName,
  findMoveOffer,
  moveCardId,
  moveQuestion,
  sendAsTyped,
  type MoveChoice,
  type MoveOffer,
} from "./move-offers.ts";
import { askWhereItGoes, localDay } from "./move-ask.ts";
import { useFirstmateModel } from "./firstmate.ts";
import { Home, type IntakeStep } from "./home.tsx";
import {
  ActivityPanel,
  DecisionsPanel,
  DownloadsPanel,
  LibraryPanel,
  Rail,
} from "./rail.tsx";
import {
  Agents,
  Council,
  Portfolio,
  Rfps,
  Roadmap,
  Sprints,
} from "./screens.tsx";
import type { SettingsSection } from "./settings.tsx";
import { Settings } from "./lazy.tsx";
import {
  connectWorkStore,
  council,
  retryWorkSnapshot,
  work,
  workAsync,
  workStore,
} from "./store.ts";
import { acceptOffer } from "./accept-offer.ts";
import { areaOf, homeModel, type Snapshot } from "./view-model.ts";
import { Wizard } from "./wizard.tsx";
import { WorkSession, type PaneTarget } from "./work-session.tsx";

function WorkspaceFailure({ reasons }: { reasons: string[] }) {
  const [copied, setCopied] = useState(false);
  const details = reasons.length ? reasons.join("\n") : "No details";
  return (
    <div role="alert" style={{ padding: 48 }}>
      <p>Amun couldn’t open your workspace. Your data is safe.</p>
      <p className="muted small" aria-live="polite">
        {copied ? "Details copied" : ""}
      </p>
      <div className="rb-inline">
        <button
          className="btn"
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(details)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          Copy details
        </button>
        <button className="btn" type="button" onClick={retryWorkSnapshot}>
          Try again
        </button>
      </div>
    </div>
  );
}

export function App() {
  const bridgeState = useSyncExternalStore(
    bridge.subscribe,
    bridge.getSnapshot,
  );
  const state = useSyncExternalStore(
    workStore.subscribe,
    workStore.getSnapshot,
  );
  const snapshot = state.snapshot;
  const [layout, dispatch] = useReducer(shellReducer, initialShell);
  const [pane, setPane] = useState<PaneTarget>(null);
  /** The fork on screen inside the open work; null is its main chat. */
  const [chatId, setChatId] = useState<string | null>(null);
  const [focusAgent, setFocusAgent] = useState<string | null>(null);
  const [pending, setPending] = useState<IntakeStep | null>(null);
  const [note, setNote] = useState("");
  const [first, setFirst] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSection>("models");
  const [libraryType, setLibraryType] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const lastDark = useRef<Exclude<ThemeId, "amun-light">>(
    "tamer-sabry-default",
  );
  const model = useFirstmateModel();
  const connected = bridgeState.connections
    .filter((connection) => /connected|ready|verified/i.test(connection.status))
    .map((connection) => connection.kind as string);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => {
      clearInterval(timer);
      media.removeEventListener("change", change);
    };
  }, []);
  useEffect(() => {
    // Shortcuts pressed while the browser view has focus arrive as messages.
    const listener = (event: MessageEvent) => {
      if (event.source === window && event.data?.kind === "amun-shell-shortcut")
        window.dispatchEvent(new KeyboardEvent("keydown", event.data.input));
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    // The Council is installed and read only when one of its screens is open.
    if (
      bridgeState.status === "Connected" &&
      (layout.route === "council" || layout.route === "settings")
    )
      council("status");
  }, [bridgeState.status, layout.route]);
  const choice = snapshot?.setup.theme ?? "system";
  useEffect(() => {
    if (choice !== "system" && choice !== "amun-light")
      lastDark.current = choice;
    document.documentElement.dataset.theme = resolveTheme({
      choice,
      systemDark,
      lastDark: lastDark.current,
    });
  }, [choice, systemDark]);
  // "While you were away" compares against the last time Home was left.
  useEffect(() => {
    const leave = () => {
      if (document.visibilityState === "hidden") work("seen");
    };
    document.addEventListener("visibilitychange", leave);
    return () => document.removeEventListener("visibilitychange", leave);
  }, []);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "palette", open: !layout.palette });
      } else if (event.metaKey && event.key === "\\") {
        event.preventDefault();
        dispatch({ type: "toggle_sidebar" });
      } else if (event.key === "Escape" && !bridgeState.prompt && layout.rail) {
        dispatch({ type: "rail", item: layout.rail });
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [layout.palette, layout.rail, bridgeState.prompt]);
  // The earlier PRD and backlog flows follow the selected product. In
  // Settings › Skills they follow the product chosen there, which starts as
  // the one the owner last opened.
  const activeArea = snapshot ? areaOf(snapshot, layout.workAreaId) : null;
  const [lastProduct, setLastProduct] = useState<string | null>(null);
  const [skillsProduct, setSkillsProduct] = useState("");
  useEffect(() => {
    if (activeArea?.productId) setLastProduct(activeArea.productId);
  }, [activeArea?.productId]);
  const products = bridgeState.workspace?.products ?? [];
  const recentProduct = (snapshot?.areas ?? [])
    .filter((area) => area.productId)
    .sort((a, b) =>
      (b.lastContextAt ?? b.createdAt).localeCompare(
        a.lastContextAt ?? a.createdAt,
      ),
    )[0]?.productId;
  const recentArea = [...(snapshot?.areas ?? [])].sort((a, b) =>
    (b.lastContextAt ?? b.createdAt).localeCompare(
      a.lastContextAt ?? a.createdAt,
    ),
  )[0]?.id;
  const settingsProduct =
    [skillsProduct, lastProduct, recentProduct].find((id) =>
      products.some((product) => product.id === id),
    ) ??
    products[0]?.id ??
    null;
  const wantedProduct =
    layout.route === "settings" && section === "skills"
      ? settingsProduct
      : (activeArea?.productId ?? null);
  useEffect(() => {
    const preferences = bridgeState.workspace?.preferences;
    if (preferences && preferences.productId !== wantedProduct)
      bridge.send({
        version: 1,
        kind: "workspace",
        action: "preferences",
        preferences: { ...preferences, productId: wantedProduct },
      });
  }, [wantedProduct, bridgeState.workspace?.preferences.productId]);
  useEffect(() => {
    dispatch({
      type: "artifact",
      open: pane !== null && layout.route === "work",
    });
  }, [pane, layout.route]);

  const downloadCount = (bridgeState.workspace?.artifacts ?? []).filter(
    (item) => ["export", "download"].includes(item.kind),
  ).length;
  // A new download shows itself: the panel flies out for a few seconds and
  // closes again unless the pointer or keyboard is in it.
  const seenDownloads = useRef<number | null>(null);
  const flownOut = useRef(false);
  useEffect(() => {
    const before = seenDownloads.current;
    seenDownloads.current = downloadCount;
    if (before === null || downloadCount <= before || layout.rail) return;
    flownOut.current = true;
    dispatch({ type: "rail", item: "downloads" });
  }, [downloadCount]);
  useEffect(() => {
    if (layout.rail !== "downloads" || !flownOut.current) {
      if (layout.rail !== "downloads") flownOut.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const drawer = document.querySelector(".rb-drawer.popover");
      // Someone is using it: leave it open.
      if (drawer?.matches(":hover") || drawer?.contains(document.activeElement))
        return;
      flownOut.current = false;
      dispatch({ type: "rail", item: "downloads" });
    }, downloadsFloatMs);
    return () => clearTimeout(timer);
  }, [layout.rail, downloadCount]);
  // A work that was deleted while its chat was open: back to Home.
  const openAreaGone =
    layout.route === "work" &&
    !!layout.workAreaId &&
    !!snapshot &&
    !snapshot.areas.some((area) => area.id === layout.workAreaId);
  useEffect(() => {
    if (!openAreaGone) return;
    setPane(null);
    setFirst(null);
    dispatch({ type: "go", route: "home" });
  }, [openAreaGone]);
  if (!snapshot && state.failure)
    return (
      <div className="rb setup">
        <WorkspaceFailure reasons={state.failure} />
        <AuthPrompt />
      </div>
    );
  if (!snapshot)
    return (
      <div className="rb setup">
        <div className="rb-loading" role="status" aria-live="polite">
          <span className="rb-loading-mark" aria-hidden="true">
            <span className="rb-loading-shine" />
          </span>
          <p>Loading Amun</p>
        </div>
        <AuthPrompt />
      </div>
    );
  if (!snapshot.setup.completed)
    return (
      <div className="rb setup">
        <Wizard connected={connected} />
        <AuthPrompt />
      </div>
    );

  const go = (route: Exclude<Route, "work" | "setup">) => {
    setPane(null);
    setFirst(null);
    dispatch({ type: "go", route });
  };
  const openWork = (
    areaId: string,
    message?: string,
    target: PaneTarget = null,
    chat: string | null = null,
  ) => {
    setPending(null);
    setNote("");
    setFirst(message ?? null);
    setPane(target);
    setChatId(chat);
    dispatch({ type: "open_work", workAreaId: areaId });
  };
  /** The standing conversation of a group, made when there is none yet. */
  const looseArea = async (groupId: string | null) => {
    const standing = snapshot.areas.find(
      (area) =>
        area.name === generalConversationName &&
        (groupId === null || area.groupId === groupId),
    );
    if (standing) return standing.id;
    const made = await workAsync("create-area", {
      groupId,
      type: "task",
      name: generalConversationName,
    });
    return made.ok ? made.ref : null;
  };
  /** The chat a message with no folder goes to: the latest one still open. */
  const looseChat = async (groupId: string | null) => {
    const areaId = await looseArea(groupId);
    if (!areaId) return null;
    const area = snapshot.areas.find((item) => item.id === areaId);
    const latest = area
      ? latestOpenChat(area, snapshot.chats, snapshot.messages)
      : null;
    if (latest !== undefined) return { areaId, chatId: latest };
    const made = await workAsync("new-chat", { workAreaId: areaId });
    return made.ok && made.ref ? { areaId, chatId: made.ref } : null;
  };
  /** "New chat" on a folder, or in the Chats list (no folder). */
  const startChat = async (folderId: string | null) => {
    const areaId =
      folderId ??
      (await looseArea(
        snapshot.setup.activeGroupId ?? snapshot.groups[0]?.id ?? null,
      ));
    if (!areaId) return;
    // A chat nobody has written in yet is the new chat; a second is not made.
    const area = snapshot.areas.find((item) => item.id === areaId);
    const unused = area
      ? chatsOf(area, snapshot.chats, snapshot.messages).find(
          (chat) => chat.empty && chat.archivedAt === null,
        )
      : undefined;
    if (unused || !area)
      return openWork(areaId, undefined, null, unused?.chatId ?? null);
    const made = await workAsync("new-chat", { workAreaId: areaId });
    if (made.ok && made.ref) openWork(areaId, undefined, null, made.ref);
    else setNote(made.message);
  };
  /** The owner's choice on "where should this go?". Nothing moved before it. */
  const resolveMove = async (
    item: Attention,
    choice: MoveChoice,
    typedName: string,
  ) => {
    const raw = snapshot.attention.find((entry) => entry.id === item.id);
    const offer = findMoveOffer(snapshot, raw?.ref);
    const cardId = moveCardId(raw?.ref);
    const done = () =>
      workAsync("resolve-attention", {
        attentionId: item.id,
        resolution: "done",
      });
    if (!offer || !cardId) return void done();
    if (choice === "keep") {
      await workAsync("keep-here", {
        workAreaId: offer.workAreaId,
        name: offer.request.name,
      });
      await workAsync("settle-card", {
        messageId: cardId,
        card: { ...offer, state: "kept" } as never,
      });
      await done();
      if (offer.held !== null) {
        sendAsTyped(offer.held);
        openWork(offer.workAreaId, offer.held, null, offer.chatId);
      }
      return;
    }
    const source = snapshot.areas.find((area) => area.id === offer.workAreaId);
    let targetId = choice === "existing" ? offer.existingAreaId : null;
    if (!targetId) {
      const name =
        choice === "another"
          ? anotherName(
              offer.request.name,
              snapshot.areas.map((area) => area.name),
            )
          : typedName || offer.request.name;
      const made = await workAsync("create-area", {
        groupId: source?.groupId ?? snapshot.setup.activeGroupId,
        type: offer.request.type,
        name,
        ...(offer.request.priority ? { priority: offer.request.priority } : {}),
        ...(offer.request.dueDate ? { dueAt: offer.request.dueDate } : {}),
      });
      if (!made.ok || !made.ref) return setNote(made.message);
      targetId = made.ref;
    }
    const target = snapshot.areas.find((area) => area.id === targetId);
    const name =
      target?.name ??
      (choice === "new" && typedName ? typedName : offer.request.name);
    if (offer.held === null) {
      // Messages already sent are re-filed as a chat in that folder.
      const moved = await workAsync("move-chat", {
        workAreaId: offer.workAreaId,
        chatId: offer.chatId,
        ...(offer.fromMessageId ? { fromMessageId: offer.fromMessageId } : {}),
        toWorkAreaId: targetId,
      });
      if (!moved.ok) return setNote(moved.message);
      await workAsync("settle-card", {
        messageId: cardId,
        card: { ...offer, state: "kept" } as never,
      });
      await done();
      return openWork(targetId, undefined, null, moved.ref);
    }
    // A held message becomes a chat of its own in that folder.
    const used =
      !!target &&
      chatsOf(target, snapshot.chats, snapshot.messages).some(
        (chat) => chat.kind === "first" && !chat.empty,
      );
    const chat = used
      ? (await workAsync("new-chat", { workAreaId: targetId })).ref
      : null;
    await workAsync("settle-card", {
      messageId: cardId,
      card: {
        ...offer,
        state: "moved",
        to: { workAreaId: targetId, chatId: chat, name },
      } as never,
    });
    await done();
    sendAsTyped(offer.held);
    openWork(targetId, offer.held, null, chat);
  };
  const submit = async (text: string, files: string[], groupId?: string) => {
    setNote("");
    // "Create a new project for Gitex, high priority, ready on Dec 6": make
    // the folder with what was said and start there. A name a folder already
    // has is asked about first, on Firstmate's card.
    const group =
      groupId ??
      snapshot.setup.activeGroupId ??
      (snapshot.groups.length === 1 ? snapshot.groups[0]!.id : null);
    const routed = files.length
      ? ({ route: "none" } as const)
      : routeNewWork({
          text,
          today: localDay(now),
          areas: snapshot.areas.filter(
            (area) =>
              area.name !== generalConversationName &&
              (!group || !area.groupId || area.groupId === group),
          ),
          inside: null,
        });
    if (routed.route === "create" && group) {
      const made = await workAsync("create-area", {
        groupId: group,
        type: routed.request.type,
        name: routed.request.name,
        ...(routed.request.priority
          ? { priority: routed.request.priority }
          : {}),
        ...(routed.request.dueDate ? { dueAt: routed.request.dueDate } : {}),
      });
      if (made.ok && made.ref) return openWork(made.ref, text);
    }
    if (routed.route === "existing") {
      const general = await looseChat(group);
      if (general) {
        const existing = snapshot.areas.find(
          (area) => area.id === routed.areaId,
        );
        const offer: MoveOffer = {
          kind: "move-offer",
          state: "open",
          held: text,
          fromMessageId: null,
          request: routed.request,
          existingAreaId: routed.areaId,
          workAreaId: general.areaId,
          chatId: general.chatId,
        };
        const asked = await askWhereItGoes(
          offer,
          moveQuestion(offer, null, existing?.name ?? routed.request.name),
          group,
        );
        if (asked)
          return openWork(general.areaId, undefined, null, general.chatId);
      }
    }
    const result = await workAsync("intake", {
      text,
      fileNames: files,
      groupId: groupId ?? snapshot.setup.activeGroupId,
    });
    const step = (result.step ?? {}) as Partial<IntakeStep> & {
      areaId?: string;
    };
    if (step.step === "file_work" && step.areaId)
      return openWork(step.areaId, text);
    // Anything Home has to show (a note, or a question about new work) is
    // shown there, whichever screen the message was sent from.
    const onHome = () => {
      if (layout.route !== "home") dispatch({ type: "go", route: "home" });
    };
    if (!result.ok || step.step === "unreadable" || step.step === "reminder") {
      onHome();
      return setNote(result.message);
    }
    // A question or a request for Firstmate is not work to file: it goes
    // straight to Firstmate, who answers from what was said. Only a message
    // that itself asks for a new product, project, task or RFP is asked about.
    if (step.step === "choose_work" && !asksForNewWork(text)) {
      // It goes to the latest chat that has no folder (owner, 19 November 2026).
      const loose = await looseChat(step.groupId ?? null);
      if (loose) return openWork(loose.areaId, text, null, loose.chatId);
    }
    onHome();
    setPending({ ...step, step: step.step ?? "", text, files });
  };
  const view = homeModel(
    snapshot,
    now,
    layout.route === "work" ? layout.workAreaId : null,
  );
  const topRaw = view.island.top
    ? snapshot.attention.find((item) => item.id === view.island.top!.id)
    : undefined;
  const topOffer = findMoveOffer(snapshot, topRaw?.ref);
  const topMove: IslandMove | null = topOffer
    ? {
        question: moveQuestion(
          topOffer,
          snapshot.areas.find((area) => area.id === topOffer.workAreaId)
            ?.name ?? null,
          snapshot.areas.find((area) => area.id === topOffer.existingAreaId)
            ?.name ?? null,
        ),
        name: topOffer.request.name,
      }
    : null;
  const openAttention = (item: Attention) => {
    const raw = snapshot.attention.find((entry) => entry.id === item.id);
    const plan = raw?.ref?.startsWith("plan:") ? raw.ref.slice(5) : null;
    if (item.workAreaId)
      openWork(
        item.workAreaId,
        undefined,
        plan ? { kind: "plan", id: plan } : null,
      );
    else if (item.kind === "linking")
      dispatch({ type: "rail", item: "library" });
    else go("home");
  };
  const downloads = (bridgeState.workspace?.artifacts ?? [])
    .filter((item) => ["export", "download"].includes(item.kind))
    .map((item) => ({
      id: item.id,
      name: item.ref.split("/").pop() ?? item.ref,
      type: item.kind,
    }));
  const downloaded: LibraryItem[] = downloads.map((file) => ({
    id: file.id,
    section: "output",
    type: "download",
    title: file.name,
    groupId: null,
    workAreaIds: [],
    status: "Downloaded",
    needsLinking: false,
    updatedAt: "",
  }));
  const openLibraryItem = (item: LibraryItem) => {
    if (item.type === "download") return;
    const areaId = layout.workAreaId ?? item.workAreaIds[0];
    if (!areaId) {
      setNote(
        "Link this to a piece of work to open it beside its conversation.",
      );
      return;
    }
    openWork(areaId, undefined, { kind: "output", id: item.id });
    dispatch({ type: "rail", item: null });
  };
  const collapsed = sidebarCollapsed(layout);
  const running = snapshot.activity.filter(
    (item) => item.state === "running",
  ).length;
  const waiting = snapshot.decisions.filter(
    (item) => item.outcome === null,
  ).length;
  const railTitle = {
    activity: "Activity",
    downloads: "Recent downloads",
    library: "Library",
    decisions: "Decisions",
  };
  const railBody = (item: NonNullable<typeof layout.rail>) =>
    item === "activity" ? (
      <ActivityPanel snapshot={snapshot} onWork={(id) => openWork(id)} />
    ) : item === "library" ? (
      <LibraryPanel
        key={(layout.workAreaId ?? "all") + (libraryType ?? "")}
        snapshot={snapshot}
        workAreaId={layout.workAreaId}
        initialType={libraryType}
        extra={downloaded}
        onOpen={openLibraryItem}
        onWork={(id) => openWork(id)}
      />
    ) : (
      <DecisionsPanel
        key={layout.workAreaId ?? "all"}
        snapshot={snapshot}
        workAreaId={layout.workAreaId}
        onReview={(id) => {
          const decision = snapshot.decisions.find((entry) => entry.id === id);
          if (decision?.workAreaId) openWork(decision.workAreaId);
          dispatch({ type: "rail", item: null });
        }}
      />
    );
  const expandedRail =
    layout.rail && layout.railExpanded && layout.rail !== "downloads";
  return (
    <div className={"rb" + (collapsed ? " collapsed" : "")}>
      <Sidebar
        route={layout.route}
        collapsed={collapsed}
        onRoute={go}
        onSearch={() => dispatch({ type: "palette", open: true })}
        onToggle={() => dispatch({ type: "toggle_sidebar" })}
        snapshot={snapshot as Snapshot}
        open={
          layout.route === "work" && layout.workAreaId
            ? { areaId: layout.workAreaId, chatId }
            : null
        }
        onChat={(areaId, chat) => openWork(areaId, undefined, null, chat)}
        onNewChat={(areaId) => void startChat(areaId)}
        island={
          <Island
            top={view.island.top}
            count={view.island.count}
            held={view.island.held}
            options={topRaw?.options ?? []}
            collapsed={collapsed}
            move={topMove}
            actions={{
              onOpen: openAttention,
              onPrimary: (item) => {
                if (item.kind === "offer") {
                  const raw = snapshot.attention.find(
                    (entry) => entry.id === item.id,
                  );
                  if (!raw) return;
                  const accepted = acceptOffer(raw);
                  setNote(accepted.note);
                  if (accepted.areaId) openWork(accepted.areaId);
                  return;
                }
                if (item.kind === "result")
                  work("resolve-attention", {
                    attentionId: item.id,
                    resolution: "done",
                  });
                openAttention(item);
              },
              onAnswer: (item, answer) =>
                work("resolve-attention", {
                  attentionId: item.id,
                  resolution: "answer",
                  answer,
                }),
              onMove: (item, choice, name) =>
                void resolveMove(item, choice, name),
            }}
          />
        }
      />
      <main className="rb-main" data-testid="workspace">
        {bridgeState.status !== "Connected" && (
          <p
            className="rb-notice"
            role="status"
            style={{ margin: "44px 32px 0" }}
          >
            <span>Reconnecting to Amun’s service. Your work is saved.</span>
          </p>
        )}
        {bridgeState.notice && (
          <p
            className="rb-notice"
            role="alert"
            style={{ margin: "44px 32px 0" }}
          >
            <span>{bridgeState.notice}</span>
            <button
              className="icon-btn"
              aria-label="Dismiss message"
              onClick={() => bridge.clearNotice()}
            >
              <Icon name="close" width={16} height={16} />
            </button>
          </p>
        )}
        {expandedRail ? (
          <div className="rb-scroll">
            <div className="rb-page">
              <header className="rb-head">
                <h1>{railTitle[layout.rail!]}</h1>
                <div className="row">
                  <button
                    className="btn quiet"
                    onClick={() => dispatch({ type: "expand_rail" })}
                  >
                    Back to the side panel
                  </button>
                </div>
              </header>
              <div style={{ display: "grid", gap: 14 }}>
                {railBody(layout.rail!)}
              </div>
            </div>
          </div>
        ) : layout.route === "home" ? (
          <Home
            snapshot={snapshot}
            now={now}
            model={model}
            pending={pending}
            note={note}
            connected={connected}
            onSend={(text, files) => void submit(text, files)}
            onResubmit={(text, files, groupId) =>
              void submit(text, files, groupId)
            }
            onOpen={(areaId, message) =>
              areaId ? openWork(areaId, message) : go("home")
            }
            onPortfolio={() => go("portfolio")}
            onPendingDone={(text) => {
              setPending(null);
              setNote(text ?? "");
            }}
            onNote={setNote}
          />
        ) : layout.route === "work" && layout.workAreaId ? (
          <WorkSession
            key={layout.workAreaId + ":" + (chatId ?? "")}
            snapshot={snapshot}
            workspace={bridgeState.workspace}
            areaId={layout.workAreaId}
            chatId={chatId}
            onChat={(next) => {
              setFirst(null);
              setChatId(next);
            }}
            onWork={(areaId, chat, message) =>
              openWork(areaId, message, null, chat)
            }
            now={now}
            model={model}
            pane={pane}
            ratio={
              layout.artifact.ratio === 1
                ? layout.artifact.restore
                : layout.artifact.ratio
            }
            expanded={layout.artifact.expanded}
            first={first}
            onPane={setPane}
            onResize={(ratio) => dispatch({ type: "resize", ratio })}
            onExpand={() => dispatch({ type: "expand_artifact" })}
            onGroupNeeded={() => {
              setSection("groups");
              go("settings");
            }}
            onSettings={() => {
              setSection("models");
              go("settings");
            }}
          />
        ) : layout.route === "agents" ? (
          <Agents
            key={focusAgent ?? "agents"}
            snapshot={snapshot}
            initialAgent={focusAgent}
            model={model}
            onAsk={(text) => void submit(text, [])}
            {...(recentArea && {
              onLink: (url: string) =>
                openWork(recentArea, undefined, { kind: "browser", url }),
            })}
          />
        ) : layout.route === "council" ? (
          <Council
            snapshot={snapshot}
            status={state.council}
            problem={
              state.result?.action === "council-run" && !state.result.ok
                ? state.result.message
                : ""
            }
            model={model}
            onStart={(text, workAreaId) =>
              council("run", {
                text,
                workAreaId,
                groupId: snapshot.setup.activeGroupId,
              })
            }
            onWork={(id) => openWork(id)}
          />
        ) : layout.route === "roadmap" ? (
          <Roadmap
            snapshot={snapshot}
            model={model}
            onReview={(planId, areaId) =>
              areaId &&
              openWork(areaId, undefined, { kind: "plan", id: planId })
            }
          />
        ) : layout.route === "sprints" ? (
          <Sprints
            snapshot={snapshot}
            now={now}
            model={model}
            onWork={(id, message) => openWork(id, message)}
            onReview={(planId, areaId) =>
              areaId &&
              openWork(areaId, undefined, { kind: "plan", id: planId })
            }
          />
        ) : layout.route === "portfolio" ? (
          <Portfolio
            snapshot={snapshot}
            model={model}
            onWork={(id) => openWork(id)}
            onAsk={(text, files) => void submit(text, files)}
          />
        ) : layout.route === "rfps" ? (
          <Rfps
            snapshot={snapshot}
            now={now}
            model={model}
            onWork={(id) => openWork(id)}
          />
        ) : (
          <Settings
            snapshot={snapshot}
            workspace={bridgeState.workspace}
            councilStatus={state.council}
            section={section}
            onSection={setSection}
            skillsProductId={settingsProduct}
            onSkillsProduct={setSkillsProduct}
          />
        )}
        {layout.rail && !expandedRail && (
          <aside
            className={
              "rb-drawer" +
              (layout.rail === "downloads" ? " popover" : "") +
              // Shown by a new download: a line counts down until it closes.
              (layout.rail === "downloads" && flownOut.current ? " timed" : "")
            }
            role="dialog"
            aria-modal="false"
            aria-label={railTitle[layout.rail]}
          >
            {layout.rail === "downloads" ? (
              <DownloadsPanel
                files={downloads}
                onViewAll={() => {
                  setLibraryType("download");
                  dispatch({ type: "rail", item: "library" });
                }}
              />
            ) : (
              <>
                <header>
                  <h2>{railTitle[layout.rail]}</h2>
                  {layout.rail !== "activity" && (
                    <button
                      className="icon-btn"
                      aria-label={`Open ${railTitle[layout.rail]} in the main workspace`}
                      onClick={() => dispatch({ type: "expand_rail" })}
                    >
                      <Icon name="expand" width={16} height={16} />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    aria-label="Close"
                    onClick={() =>
                      dispatch({ type: "rail", item: layout.rail })
                    }
                  >
                    <Icon name="close" width={16} height={16} />
                  </button>
                </header>
                <div className="body">{railBody(layout.rail)}</div>
              </>
            )}
          </aside>
        )}
      </main>
      <Rail
        open={layout.rail}
        running={running}
        waiting={waiting}
        downloads={downloads.length}
        agents={(snapshot?.agents ?? []).filter(
          (agent) =>
            agent.kind !== "lead" &&
            (agent.state === "working" || agent.state === "waiting"),
        )}
        onAgent={(id) => {
          setFocusAgent(id);
          go("agents");
        }}
        onOpen={(item) => {
          if (item !== "library") setLibraryType(null);
          dispatch({ type: "rail", item });
        }}
      />
      <Palette
        open={layout.palette}
        snapshot={snapshot as Snapshot}
        onClose={() => dispatch({ type: "palette", open: false })}
        onRoute={go}
        onWork={(id) => openWork(id)}
        onHit={(item) => {
          dispatch({ type: "palette", open: false });
          if (!item.workAreaId) {
            go("home");
            if (item.kind !== "message" && item.kind !== "step")
              setNote(
                "Link this to a piece of work to open it beside its conversation.",
              );
            return;
          }
          // Words in a conversation and Firstmate's steps open the
          // conversation with "What happened" beside it, at that step.
          openWork(
            item.workAreaId,
            undefined,
            item.kind === "document"
              ? { kind: "output", id: item.id }
              : item.kind === "step"
                ? { kind: "happened", stepId: item.id }
                : item.kind === "message"
                  ? { kind: "happened" }
                  : null,
            // Words written in a fork open that fork, not the main chat.
            item.kind === "message"
              ? ((snapshot as Snapshot).chats.find((chat) =>
                  chat.messages.some((message) => message.id === item.id),
                )?.id ?? null)
              : null,
          );
        }}
        onBrowser={
          layout.route === "work"
            ? () => {
                dispatch({ type: "palette", open: false });
                setPane({ kind: "browser", url: "https://www.google.com" });
              }
            : null
        }
      />
      <AuthPrompt />
    </div>
  );
}

export function startRebuiltShell() {
  initializeBridge();
  connectWorkStore();
  const root = document.getElementById("root");
  if (!root) throw Error("Missing application root");
  createRoot(root).render(<App />);
}
