// Amun shell v3 (handoff §4): sidebar · main workspace · rail. Replaces the
// earlier shell at its mount point; see docs/UX-REBUILD.md for what was
// switched off and how to restore it.
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
import { Island, Palette, Sidebar } from "./chrome.tsx";
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
  work,
  workAsync,
  workStore,
} from "./store.ts";
import { areaOf, homeModel, type Snapshot } from "./view-model.ts";
import { Wizard } from "./wizard.tsx";
import { WorkSession, type PaneTarget } from "./work-session.tsx";

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
  const [pending, setPending] = useState<IntakeStep | null>(null);
  const [note, setNote] = useState("");
  const [first, setFirst] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSection>("models");
  const [libraryType, setLibraryType] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const lastDark = useRef<"tamer-sabry-default" | "navy-gold" | "navy-cyan">(
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
  // The earlier PRD and backlog flows follow the selected product.
  const activeArea = snapshot ? areaOf(snapshot, layout.workAreaId) : null;
  useEffect(() => {
    const productId = activeArea?.productId ?? null;
    const preferences = bridgeState.workspace?.preferences;
    if (preferences && preferences.productId !== productId)
      bridge.send({
        version: 1,
        kind: "workspace",
        action: "preferences",
        preferences: { ...preferences, productId },
      });
  }, [activeArea?.productId, bridgeState.workspace?.preferences.productId]);
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
  if (!snapshot)
    return (
      <div className="rb setup">
        <p role="status" className="muted" style={{ padding: 48 }}>
          {bridgeState.status === "Connected"
            ? "Opening Amun…"
            : "Starting Amun…"}
        </p>
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
  ) => {
    setPending(null);
    setNote("");
    setFirst(message ?? null);
    setPane(target);
    dispatch({ type: "open_work", workAreaId: areaId });
  };
  const submit = async (text: string, files: string[], groupId?: string) => {
    setNote("");
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
    if (!result.ok && step.step !== "unreadable")
      return setNote(result.message);
    if (step.step === "unreadable") return setNote(result.message);
    setPending({ ...step, step: step.step ?? "", text, files });
  };
  const view = homeModel(snapshot, now);
  const topRaw = view.island.top
    ? snapshot.attention.find((item) => item.id === view.island.top!.id)
    : undefined;
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
        island={
          <Island
            top={view.island.top}
            count={view.island.count}
            options={topRaw?.options ?? []}
            collapsed={collapsed}
            actions={{
              onOpen: openAttention,
              onPrimary: (item) => {
                if (item.kind === "offer") {
                  work("resolve-attention", {
                    attentionId: item.id,
                    resolution: "accept",
                  });
                  setNote(
                    "Draft only · Nothing sent · Approval status unchanged",
                  );
                  if (item.workAreaId) openWork(item.workAreaId);
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
            key={layout.workAreaId}
            snapshot={snapshot}
            workspace={bridgeState.workspace}
            areaId={layout.workAreaId}
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
            onDiagnostics={() => {
              setSection("advanced");
              go("settings");
            }}
            onSettings={() => {
              setSection("models");
              go("settings");
            }}
          />
        ) : layout.route === "agents" ? (
          <Agents snapshot={snapshot} model={model} />
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
          <Portfolio snapshot={snapshot} onWork={(id) => openWork(id)} />
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
