import { AgentsPanel } from "./agents-panel.tsx";
import { NativePiPanel } from "./native-pi-panel.tsx";
import { canSubmitAuthPrompt } from "./auth-prompt.ts";
import { createRoot } from "react-dom/client";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  modelLoginOptions,
  obsidianEndpoints,
  type AttentionItem,
  type UiPreferences,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import {
  attentionQueue,
  activitySummary,
} from "../../../packages/domain/src/attention.ts";
import { bridge, initializeBridge } from "./bridge.ts";
import {
  initialLayout,
  layoutReducer,
  type Drawer,
  type IslandSize,
} from "./layout.ts";
import { Island, attentionLabels } from "./island.tsx";
import { Icon } from "./icons.tsx";
import { TerminalPane } from "./terminal-pane.tsx";
import "./tokens.css";
import "./shell.css";
const tools = [
  ["browser", "Browser"],
  ["terminal", "Terminal"],
  ["requests", "Requests"],
  ["agents", "Agents"],
  ["decisions", "Decisions"],
  ["priorities", "Priorities"],
] as const;
const navigation = [
  ["overview", "Overview"],
  ["prd", "PRD"],
  ["backlog", "Backlog"],
  ["sprint", "Sprint"],
  ["prs", "PRs"],
] as const;
const drawers: [Drawer, string, string][] = [
  ["notifications", "Notifications", "requests"],
  ["activity", "Activity", "activity"],
  ["artifacts", "Artifacts", "artifacts"],
  ["downloads", "Downloads", "downloads"],
  ["skills", "Skills and extensions", "skills"],
];
const themes = [
  ["tamer-sabry-default", "Tamer Sabry default"],
  ["navy-gold", "Navy Gold"],
  ["navy-cyan", "Navy Cyan"],
] as const;
const emptyPreferences: UiPreferences = {
  theme: "tamer-sabry-default",
  productId: null,
  islandSize: "card",
  pinnedTabs: [],
};
const command = (action: string, extra: Record<string, unknown> = {}) =>
  bridge.send({ version: 1, kind: "workspace", action, ...extra });
const browser = (value: unknown) =>
  window.postMessage({ kind: "amun-browser-command", command: value }, "*");
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        A
      </span>
      <strong>Amun</strong>
      <span className="brand-context">/ Workspace</span>
    </div>
  );
}
function AuthPrompt() {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const [value, setValue] = useState("");
  const prompt = state.prompt;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setValue("");
    if (prompt && !dialog.current?.open) dialog.current?.showModal();
    if (!prompt && dialog.current?.open) dialog.current.close();
  }, [prompt?.id]);
  const cancel = () => {
    bridge.send({ version: 1, kind: "auth", action: "cancel" });
    bridge.clearPrompt();
    setValue("");
  };
  return (
    <dialog
      className="auth-dialog"
      ref={dialog}
      aria-labelledby="auth-title"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      {prompt && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            bridge.send({
              version: 1,
              kind: "auth",
              action: "answer",
              id: prompt.id,
              answer: value,
            });
            setValue("");
            bridge.clearPrompt();
          }}
        >
          <h2 id="auth-title">Complete sign-in</h2>
          <label>
            {prompt.message}
            {prompt.method === "select" ? (
              <select
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                <option value="">Choose an option</option>
                {prompt.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus
                autoComplete="off"
                type={
                  prompt.method === "secret" || prompt.method === "manual_code"
                    ? "password"
                    : "text"
                }
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={65536}
              />
            )}
          </label>
          {prompt.method === "text" &&
          prompt.message ===
            "GitHub Enterprise URL/domain (blank for github.com)" ? (
            <p className="muted">
              Copilot signs in through github.com or your company’s
              tenant.ghe.com host. Your repository server may use a different
              address. Enter only the sign-in host, without an /enterprises
              path. Authorization opens in Microsoft Edge.
            </p>
          ) : (
            <p className="muted">
              Enter credentials only here or in the provider’s browser page.
              Browser authorization opens in Microsoft Edge.
            </p>
          )}
          <div className="button-row">
            <button
              className="primary"
              disabled={!canSubmitAuthPrompt(prompt, value)}
            >
              Continue
            </button>
            <button type="button" onClick={cancel}>
              Cancel sign-in
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
function BackupControls() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.data?.kind === "amun-backup-status" &&
        typeof event.data.message === "string"
      )
        setStatus(event.data.message);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const run = (action: string) => {
    window.postMessage(
      { kind: "amun-backup-command", command: { action, password } },
      "*",
    );
    setPassword("");
  };
  return (
    <>
      <label>
        Backup passphrase
        <input
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={1024}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <p className="muted">
        Use at least 12 characters. Keep this passphrase safe; it is required to
        restore the backup.
      </p>
      <div className="button-row">
        <button disabled={password.length < 12} onClick={() => run("export")}>
          Export encrypted backup
        </button>
        <button disabled={password.length < 12} onClick={() => run("restore")}>
          Restore to new folder
        </button>
      </div>
      <p aria-live="polite">{status}</p>
      <p className="muted">
        Restore creates a separate workspace folder. It never replaces the
        current workspace or imports sign-ins.
      </p>
    </>
  );
}
function Settings({
  initialService = "github",
  preferences,
  onPreferences,
}: {
  initialService?: "github" | "ado" | "notion" | "obsidian";
  preferences: UiPreferences;
  onPreferences(value: UiPreferences): void;
}) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const [tab, setTab] = useState("connections");
  const [kind, setKind] = useState<"github" | "ado" | "notion" | "obsidian">(
    initialService,
  );
  const [baseUrl, setBaseUrl] = useState("https://github.com");
  const keyInput = useRef<HTMLInputElement>(null);
  const [notionTarget, setNotionTarget] = useState("");
  const [confirmNotionDisconnect, setConfirmNotionDisconnect] = useState(false);
  const [notionBrowser, setNotionBrowser] = useState<"edge" | "dia">("edge");
  const [model, setModel] = useState("github-copilot:oauth");
  const modelBusy = Object.values(state.modelStatus).includes("checking");
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!keyInput.current) return;
    const secret = keyInput.current.value;
    keyInput.current.value = "";
    bridge.send({
      version: 1,
      kind: "auth",
      action: "save",
      connection: { kind, baseUrl },
      secret,
    });
  };
  return (
    <div className="settings-content">
      <div
        className="section-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {[
          ["connections", "Connections"],
          ["models", "Models"],
          ["appearance", "Appearance"],
          ["data", "Data and backup"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id!)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "connections" && (
        <section>
          <h2>Connections</h2>
          <p className="muted">
            Each connection has its own sign-in and access check.
          </p>
          <div className="connection-list">
            {state.connections.map((connection) => (
              <article key={connection.id} className="connection-row">
                <div>
                  <strong>
                    {connection.kind === "ado"
                      ? "Azure DevOps"
                      : connection.kind === "github"
                        ? "GitHub"
                        : connection.kind === "obsidian"
                          ? "Obsidian"
                          : "Notion"}
                  </strong>
                  <p>{connection.baseUrl}</p>
                  <span className="state-tag">{connection.status}</span>
                </div>
                <button
                  onClick={() =>
                    bridge.send({
                      version: 1,
                      kind: "auth",
                      action: "check",
                      connection: {
                        kind: connection.kind,
                        baseUrl: connection.baseUrl,
                      },
                    })
                  }
                >
                  Test connection
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    bridge.send({
                      version: 1,
                      kind: "auth",
                      action: "forget",
                      connection: {
                        kind: connection.kind,
                        baseUrl: connection.baseUrl,
                      },
                    })
                  }
                >
                  Disconnect
                </button>
              </article>
            ))}
          </div>
          <form className="settings-form" onSubmit={save}>
            <h3>Add a connection</h3>
            <label>
              Service
              <select
                aria-label="Service"
                value={kind}
                onChange={(event) => {
                  const value = event.target.value as typeof kind;
                  setKind(value);
                  setBaseUrl(
                    value === "github"
                      ? "https://github.com"
                      : value === "notion"
                        ? "https://api.notion.com"
                        : value === "obsidian"
                          ? obsidianEndpoints[0]
                          : "",
                  );
                  if (keyInput.current) keyInput.current.value = "";
                }}
              >
                <option value="github">GitHub or GitHub Enterprise</option>
                <option value="ado">Azure DevOps</option>
                <option value="notion">Notion</option>
                <option value="obsidian">Obsidian</option>
              </select>
            </label>
            {kind === "notion" ? (
              <div>
                <p>
                  Connect through Notion’s hosted MCP server. Sign in and choose
                  your workspace in your browser. No token entry is needed.
                </p>
                <label>
                  Sign-in browser
                  <select
                    aria-label="Sign-in browser"
                    value={notionBrowser}
                    onChange={(event) =>
                      setNotionBrowser(event.target.value as "edge" | "dia")
                    }
                  >
                    <option value="edge">Microsoft Edge</option>
                    <option value="dia">Dia</option>
                  </select>
                </label>
                <p role="status">
                  {state.modelStatus["notion-mcp"] ?? "Not checked"}
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={state.modelStatus["notion-mcp"] === "checking"}
                  onClick={() =>
                    bridge.send({
                      version: 1,
                      kind: "auth",
                      action: "notion-connect",
                      browser: notionBrowser,
                    })
                  }
                >
                  Connect Notion in browser
                </button>
                <button
                  type="button"
                  onClick={() =>
                    bridge.send({
                      version: 1,
                      kind: "auth",
                      action: "notion-check",
                    })
                  }
                >
                  Test Notion connection
                </button>
                <button
                  type="button"
                  onClick={() =>
                    bridge.send({
                      version: 1,
                      kind: "auth",
                      action: "notion-cancel",
                    })
                  }
                >
                  Cancel Notion sign-in
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmNotionDisconnect(true)}
                >
                  Disconnect Notion
                </button>
                {confirmNotionDisconnect && (
                  <div role="group" aria-label="Confirm Notion disconnect">
                    <p>
                      Remove this workspace’s saved Notion sign-in and
                      destination? Published pages will remain in Notion.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmNotionDisconnect(false);
                        setNotionTarget("");
                        bridge.send({
                          version: 1,
                          kind: "auth",
                          action: "notion-disconnect",
                        });
                      }}
                    >
                      Confirm disconnect
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmNotionDisconnect(false)}
                    >
                      Keep connection
                    </button>
                  </div>
                )}
                <label>
                  Notion destination link
                  <input
                    aria-label="Notion destination link"
                    type="url"
                    value={notionTarget}
                    onChange={(event) => setNotionTarget(event.target.value)}
                    maxLength={2048}
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    !notionTarget ||
                    state.modelStatus["notion-mcp"] === "checking"
                  }
                  onClick={() =>
                    bridge.send({
                      version: 1,
                      kind: "auth",
                      action: "notion-target",
                      url: notionTarget,
                    })
                  }
                >
                  Check Notion destination
                </button>
              </div>
            ) : (
              <>
                {" "}
                {kind === "obsidian" ? (
                  <>
                    <p>
                      Enable Local REST API with MCP in Obsidian. Copy its API
                      key from the plugin settings.
                    </p>
                    <label>
                      Plugin endpoint
                      <select
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                      >
                        <option value={obsidianEndpoints[0]}>
                          HTTPS · {obsidianEndpoints[0]}
                        </option>
                        <option value={obsidianEndpoints[1]}>
                          Local HTTP · {obsidianEndpoints[1]}
                        </option>
                      </select>
                    </label>
                    <p>
                      HTTPS requires a trusted plugin certificate. Choose local
                      HTTP only after enabling that listener in Obsidian.
                    </p>
                  </>
                ) : (
                  <label>
                    {kind === "ado"
                      ? "Collection or organisation URL"
                      : "Service URL"}
                    <input
                      type="url"
                      required
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://dev.azure.com/your-organisation"
                    />
                  </label>
                )}
                <label>
                  {kind === "obsidian"
                    ? "Obsidian plugin API key"
                    : "Personal access token"}
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    ref={keyInput}
                    maxLength={65536}
                  />
                </label>
                <p className="muted">
                  Stored in this workspace’s macOS Keychain entry. Browser
                  sign-in does not grant API access.
                </p>
                <button className="primary" type="submit">
                  Save connection
                </button>
              </>
            )}
          </form>
        </section>
      )}
      {tab === "models" && (
        <section>
          <h2>Model access through Pi</h2>
          <NativePiPanel subscriptionsOnly />
          <p className="muted">
            Provider credentials stay in Amun’s private Pi configuration. Worker
            sign-ins remain separate.
          </p>
          <label>
            Provider
            <select
              aria-label="Provider"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {modelLoginOptions.map((option) => (
                <option
                  key={option.provider + option.type}
                  value={option.provider + ":" + option.type}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={modelBusy}
              onClick={() => {
                const [provider, type] = model.split(":");
                bridge.send({
                  version: 1,
                  kind: "auth",
                  action: "login",
                  provider,
                  type,
                });
              }}
            >
              Sign in with Pi
            </button>
            <button
              onClick={() =>
                bridge.send({ version: 1, kind: "auth", action: "cancel" })
              }
            >
              Cancel sign-in
            </button>
          </div>
          <button
            disabled={modelBusy}
            onClick={() =>
              bridge.send({
                version: 1,
                kind: "auth",
                action: "readiness",
                provider: model.split(":")[0],
              })
            }
          >
            Check provider readiness
          </button>
          <ul className="plain-list">
            {[
              ...new Set(modelLoginOptions.map((option) => option.provider)),
            ].map((provider) => (
              <li key={provider}>
                <span>
                  {
                    modelLoginOptions.find(
                      (option) => option.provider === provider,
                    )?.label
                  }
                </span>
                <span className="state-tag">
                  {state.modelStatus[provider] ?? "Not checked"}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Configured credentials do not prove that a model request will
            succeed.
          </p>
        </section>
      )}
      {tab === "appearance" && (
        <section>
          <h2>Appearance</h2>
          <label>
            Theme
            <select
              value={preferences.theme}
              onChange={(event) =>
                onPreferences({
                  ...preferences,
                  theme: event.target.value as UiPreferences["theme"],
                })
              }
            >
              {themes.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="theme-preview">
            <span className="state-tag">Approval</span>
            <span className="safety-approval">Review before proceeding</span>
            <span className="safety-destructive">Destructive action</span>
          </div>
          <p className="muted">
            Approval, destructive-action and repository identity colours stay
            consistent across themes.
          </p>
        </section>
      )}
      {tab === "data" && (
        <section>
          <h2>Data and backup</h2>
          <p>
            Workspace records are stored locally. Encrypted backups exclude
            provider credential stores.
          </p>
          <BackupControls />
        </section>
      )}
    </div>
  );
}
export function App() {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const snapshot = state.workspace;
  const preferences = snapshot?.preferences ?? emptyPreferences;
  const [layout, dispatch] = useReducer(layoutReducer, initialLayout);
  const [route, setRoute] = useState("overview");
  const [returnToConversation, setReturnToConversation] = useState(false);
  const [mode, setMode] = useState("Write");
  const [selected, setSelected] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<
    WorkspaceSnapshot["artifacts"][number] | null
  >(null);
  const [filter, setFilter] = useState("open");
  const [typeFilter, setTypeFilter] = useState("all");
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [previewURL, setPreviewURL] = useState("http://localhost:3000");
  const [previewStatus, setPreviewStatus] = useState("Preview closed");
  const [handoff, setHandoff] = useState<{ id: string; host: string } | null>(
    null,
  );
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTrigger = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const previewRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDialogElement>(null);
  const savedSelection = useRef<string | null>(null);
  const products = snapshot?.products ?? [];
  const product = products.find(
    (product) => product.id === preferences.productId,
  );
  const scoped = (productId: string | null) =>
    productId === null ||
    preferences.productId === null ||
    productId === preferences.productId;
  const activities = (snapshot?.activities ?? []).filter((item) =>
    scoped(item.productId),
  );
  const summary = activitySummary(activities);
  const queue = attentionQueue(
    snapshot?.attention ?? [],
    preferences.productId,
    Date.now(),
    new Set(
      activities
        .filter((item) => item.state === "working")
        .map((item) => item.ref),
    ),
  );
  const request = (snapshot?.attention ?? []).find(
    (item) => item.id === selected,
  );
  const notifications = (snapshot?.notifications ?? []).filter((item) =>
    scoped(item.productId),
  );
  const artifacts = (snapshot?.artifacts ?? []).filter((item) =>
    scoped(item.productId),
  );
  useEffect(() => {
    browser({ action: "scope", product: preferences.productId ?? "workspace" });
    setHandoff(null);
  }, [preferences.productId]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source === window && event.data?.kind === "amun-shell-shortcut")
        window.dispatchEvent(new KeyboardEvent("keydown", event.data.input));
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const savePreferences = (value: UiPreferences) =>
    command("preferences", { preferences: value });
  const focus = () => {
    if (!layout.focus) savedSelection.current = selected;
    else setSelected(savedSelection.current);
    dispatch({ type: "focus" });
  };
  const navigate = (item: AttentionItem) => {
    setSelected(item.id);
    setArtifact(null);
    setAnswer("");
    setRoute(item.type === "reconnect" ? "settings" : "requests");
    if (item.type !== "reconnect") dispatch({ type: "inspect", tab: "issue" });
    dispatch({ type: "close" });
  };
  const snooze = (item: AttentionItem) =>
    command("snooze", {
      id: item.id,
      until: new Date(Date.now() + 3600000).toISOString(),
    });
  const answerItem = (item: AttentionItem, value: string) =>
    command("resolve", { id: item.id, source: "island", answer: value });
  const size = (value: IslandSize) => {
    dispatch({ type: "island", size: value });
    if (value !== "rail")
      savePreferences({ ...preferences, islandSize: value });
  };
  const pin = (drawer: Drawer, target?: HTMLElement) => {
    clearTimeout(hoverTimer.current);
    clearTimeout(closeTimer.current);
    drawerTrigger.current = target ?? (document.activeElement as HTMLElement);
    dispatch({ type: "pin", drawer });
  };
  const closeDrawer = () => {
    dispatch({ type: "close" });
    drawerTrigger.current?.focus();
  };
  const hover = (drawer: Drawer) => {
    clearTimeout(closeTimer.current);
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => dispatch({ type: "hover", drawer }),
      150,
    );
  };
  const leave = () => {
    clearTimeout(hoverTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => dispatch({ type: "leave" }), 250);
  };
  const openArtifact = (item: WorkspaceSnapshot["artifacts"][number]) => {
    setArtifact(item);
    setSelected(null);
    dispatch({ type: "inspect", tab: "issue" });
  };
  const pinArtifact = (item: WorkspaceSnapshot["artifacts"][number]) => {
    if (!preferences.pinnedTabs.some((pin) => pin.id === item.id))
      savePreferences({
        ...preferences,
        pinnedTabs: [
          ...preferences.pinnedTabs,
          {
            id: item.id,
            label: item.ref.split("/").pop() ?? item.kind,
            route: "artifacts",
          },
        ],
      });
  };
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
  useEffect(() => {
    dispatch({ type: "island", size: preferences.islandSize });
  }, [preferences.islandSize]);
  useEffect(() => {
    if (layout.pinned && layout.drawer)
      drawerRef.current
        ?.querySelector<HTMLElement>("[data-drawer-heading]")
        ?.focus();
  }, [layout.drawer, layout.pinned]);
  useEffect(() => {
    if (palette && !paletteRef.current?.open) paletteRef.current?.showModal();
    else if (!palette && paletteRef.current?.open) paletteRef.current.close();
  }, [palette]);
  useEffect(() => {
    if (palette) command("search", { productId: preferences.productId, query });
  }, [query, palette, preferences.productId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
        return;
      }
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        document
          .querySelector<HTMLElement>(
            ".island-primary,.pill-action,.island-rail button",
          )
          ?.focus();
        return;
      }
      if (event.metaKey && event.altKey && /^Digit[1-5]$/.test(event.code)) {
        event.preventDefault();
        pin(drawers[Number(event.code.slice(-1)) - 1]![0]);
        return;
      }
      if (event.key === "Escape" && !state.prompt) {
        if (palette) {
          setPalette(false);
          return;
        }
        if (layout.drawer) {
          event.preventDefault();
          closeDrawer();
        } else dispatch({ type: "inspect", tab: null });
      }
      if (
        event.key === "Tab" &&
        layout.pinned &&
        layout.drawer &&
        !palette &&
        !state.prompt
      ) {
        const elements = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
          ) ?? [],
        );
        const first = elements[0],
          last = elements.at(-1);
        if (!first) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !elements.includes(document.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !elements.includes(document.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [layout, selected, palette, state.prompt]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (
        event.data?.kind === "amun-browser-status" &&
        typeof event.data.message === "string"
      )
        setPreviewStatus(event.data.message);
      if (event.data?.kind === "amun-browser-handoff")
        setHandoff(event.data.handoff);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(() => {
    const update = () => {
      const rect = previewRef.current?.getBoundingClientRect();
      const visible =
        layout.inspector === "web" &&
        !layout.drawer &&
        !layout.focus &&
        !palette &&
        !state.prompt;
      browser({
        action: "layout",
        visible,
        bounds: {
          x: Math.max(0, Math.round(rect?.x ?? 0)),
          y: Math.max(0, Math.round(rect?.y ?? 0)),
          width: Math.max(1, Math.floor(rect?.width ?? 1)),
          height: Math.max(1, Math.floor(rect?.height ?? 1)),
        },
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (previewRef.current) observer.observe(previewRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [
    layout.inspector,
    layout.drawer,
    layout.focus,
    layout.terminal,
    palette,
    state.prompt,
  ]);
  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current);
      clearTimeout(closeTimer.current);
    },
    [],
  );
  const tool = (id: string) => {
    if (id === "browser") dispatch({ type: "inspect", tab: "web" });
    else if (id === "terminal") dispatch({ type: "terminal" });
    else setRoute(id);
  };
  const routeLabel =
    [
      ...navigation,
      ...tools,
      ["artifacts", "Artifacts"],
      ["settings", "Settings"],
      ["conversations", "Conversations"],
    ].find(([id]) => id === route)?.[1] ?? "Workspace";
  const requests = (snapshot?.attention ?? []).filter(
    (item) =>
      scoped(item.productId) &&
      (filter === "all" || item.state === filter) &&
      (typeFilter === "all" || item.type === typeFilter),
  );
  const drawerBody = (drawer: Drawer) =>
    drawer === "activity" ? (
      activities.length ? (
        <ul className="plain-list">
          {activities.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.text}</strong>
                <small>{item.kind.replaceAll("_", " ")}</small>
              </span>
              <span className="state-tag">{item.state}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-copy">No active work.</p>
      )
    ) : drawer === "notifications" ? (
      notifications.length ? (
        <ul className="plain-list">
          {notifications.map((item) => (
            <li key={item.id}>{item.text}</li>
          ))}
        </ul>
      ) : (
        <p className="empty-copy">You’re up to date.</p>
      )
    ) : drawer === "skills" ? (
      <>
        <p className="muted">
          Agent skills and extensions require approval. Third-party interface
          plugins are not enabled.
        </p>
        {snapshot?.skills.length ? (
          <ul className="plain-list">
            {snapshot.skills.map((skill) => (
              <li key={skill.id}>
                <span>{skill.name}</span>
                <span>{skill.version}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-copy">No skills installed in this workspace.</p>
        )}
      </>
    ) : (
      <>
        {(drawer === "downloads"
          ? artifacts.filter((item) =>
              ["export", "download"].includes(item.kind),
            )
          : artifacts
        ).map((item) => (
          <article className="artifact-row" key={item.id}>
            <strong>{item.ref.split("/").pop()}</strong>
            <span className="muted">{item.kind}</span>
            <div className="button-row">
              <button
                onClick={() => {
                  openArtifact(item);
                  closeDrawer();
                }}
              >
                Open
              </button>
              <button onClick={() => pinArtifact(item)}>Pin</button>
            </div>
          </article>
        ))}
        {!(
          drawer === "downloads"
            ? artifacts.filter((item) =>
                ["export", "download"].includes(item.kind),
              )
            : artifacts
        ).length && (
          <p className="empty-copy">
            {drawer === "downloads" ? "No downloads yet." : "No artifacts yet."}
          </p>
        )}
      </>
    );
  return (
    <div className={"app-shell" + (layout.focus ? " focus-mode" : "")}>
      <aside className="sidebar" aria-label="Workspace navigation">
        <Brand />
        <label className="product-switch">
          <Icon name="backlog" />
          <span className="sr-only">Product</span>
          <select
            value={preferences.productId ?? ""}
            onChange={(event) => {
              savePreferences({
                ...preferences,
                productId: event.target.value || null,
              });
              setSelected(null);
              setArtifact(null);
              dispatch({ type: "inspect", tab: null });
            }}
          >
            <option value="">
              {products.length ? "Portfolio" : "Workspace"}
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <button className="search-button" onClick={() => setPalette(true)}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="tool-grid">
          {tools.map(([id, label]) => (
            <button
              className={route === id ? "tool-tile selected" : "tool-tile"}
              data-testid="tool-tile"
              key={id}
              onClick={() => tool(id)}
            >
              <Icon name={id} />
              <span>{label}</span>
              {id === "requests" && (
                <span className="count" data-testid="requests-count">
                  {queue.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <nav className="product-nav" aria-label="Product workflows">
          {navigation.map(([id, label]) => (
            <button
              key={id}
              className={route === id ? "selected" : ""}
              aria-current={route === id ? "page" : undefined}
              onClick={() => setRoute(id)}
            >
              <Icon name={id} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="pinned-tabs">
          <div className="sidebar-label">Pinned tabs</div>
          {preferences.pinnedTabs.length ? (
            preferences.pinnedTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setRoute(tab.route);
                  const found = artifacts.find((item) => item.id === tab.id);
                  if (found) openArtifact(found);
                }}
              >
                <Icon name="link" />
                <span>{tab.label}</span>
              </button>
            ))
          ) : (
            <span className="muted pinned-empty">
              Pin an artifact to keep it nearby.
            </span>
          )}
        </div>
        <button
          className="artifacts-link"
          onClick={() => setRoute("artifacts")}
        >
          <Icon name="artifacts" />
          <span>Artifacts</span>
          <span className="count">{artifacts.length}</span>
        </button>
        <Island
          items={queue}
          size={layout.island}
          products={products}
          onSize={size}
          onNavigate={navigate}
          onAnswer={answerItem}
          onSnooze={snooze}
        />
        <div className="user-bar">
          <span className="avatar">Y</span>
          <span>You</span>
          <button
            className="icon-button"
            aria-label="Settings"
            onClick={() => setRoute("settings")}
          >
            <Icon name="settings" />
          </button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <Icon name="backlog" />
            <span>{product?.name ?? "Workspace"}</span>
            <span className="muted">/</span>
            <strong>{routeLabel}</strong>
          </div>
          <div className="mode-tabs" role="tablist" aria-label="Working mode">
            {["Write", "Research", "Review"].map((value) => (
              <button
                role="tab"
                key={value}
                aria-selected={mode === value}
                onClick={() => setMode(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            className={"focus-button" + (layout.focus ? " selected" : "")}
            aria-pressed={layout.focus}
            onClick={focus}
          >
            <Icon name="focus" />
            {layout.focus ? "Exit Focus" : "Focus"}
          </button>
          <button
            className={"status-pill tone-" + summary.tone}
            disabled={layout.focus}
            title={
              layout.focus ? "Exit Focus to inspect activity" : "Open Activity"
            }
            onClick={(event) => pin("activity", event.currentTarget)}
          >
            <span className="status-dot" />
            {summary.working +
              summary.publishing +
              summary.waiting +
              summary.failed ===
            0
              ? "Idle"
              : `${summary.working} working${summary.publishing ? " · " + summary.publishing + " publishing" : ""}${summary.waiting ? " · " + summary.waiting + " waiting" : ""}${summary.failed ? " · " + summary.failed + " failed" : ""}`}
          </button>
        </header>
        <div
          className={"work-area" + (layout.inspector ? " has-inspector" : "")}
        >
          <main className="workspace" data-testid="workspace">
            <div className="page-heading">
              <div>
                <p className="context-label">
                  {product?.name ?? "Your workspace"}
                </p>
                <h1>{routeLabel}</h1>
              </div>
              <span
                id="service-status"
                role="status"
                className={
                  "service-state " +
                  (state.status === "Connected" ? "connected" : "")
                }
              >
                {state.status}
              </span>
            </div>
            {state.notice && (
              <div className="notice" role="alert">
                <span>{state.notice}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss message"
                  onClick={() => bridge.clearNotice()}
                >
                  <Icon name="close" />
                </button>
              </div>
            )}
            {route === "settings" ? (
              <>
                {returnToConversation && (
                  <button
                    type="button"
                    onClick={() => {
                      setReturnToConversation(false);
                      setRoute("conversations");
                    }}
                  >
                    Return to conversation
                  </button>
                )}
                <Settings
                  initialService={returnToConversation ? "notion" : "github"}
                  preferences={preferences}
                  onPreferences={savePreferences}
                />
              </>
            ) : route === "conversations" ? (
              <NativePiPanel
                onConnectNotion={() => {
                  setReturnToConversation(true);
                  setRoute("settings");
                }}
              />
            ) : route === "requests" ? (
              <>
                <div className="request-filters">
                  <label>
                    State
                    <select
                      aria-label="State"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                    >
                      <option value="open">Open</option>
                      <option value="resolved">Resolved</option>
                      <option value="snoozed">Snoozed</option>
                      <option value="all">All requests</option>
                    </select>
                  </label>
                  <label>
                    Type
                    <select
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value)}
                    >
                      <option value="all">All types</option>
                      {Object.entries(attentionLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="request-list">
                  {requests.length ? (
                    requests.map((item) => (
                      <button
                        key={item.id}
                        className={
                          "request-row" +
                          (selected === item.id ? " selected" : "")
                        }
                        onClick={() => navigate(item)}
                      >
                        <span className={"request-type type-" + item.type}>
                          {attentionLabels[item.type]}
                        </span>
                        <span className="request-copy">
                          <strong>{item.ask}</strong>
                          <small>{item.origin.label}</small>
                        </span>
                        <span className="state-tag">{item.state}</span>
                        <Icon name="chevron" />
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">
                      <Icon name="requests" />
                      <h2>
                        {filter === "open"
                          ? "Nothing needs you right now"
                          : "No requests in this view"}
                      </h2>
                      <p>
                        Requests stay in history after they are resolved or
                        snoozed.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : route === "artifacts" ? (
              <div className="artifact-grid">
                {artifacts.length ? (
                  artifacts.map((item) => (
                    <article className="artifact-card" key={item.id}>
                      <Icon name="prd" />
                      <h2>{item.ref.split("/").pop()}</h2>
                      <p>{item.kind}</p>
                      <div className="button-row">
                        <button onClick={() => openArtifact(item)}>Open</button>
                        <button onClick={() => pinArtifact(item)}>Pin</button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <Icon name="artifacts" />
                    <h2>No artifacts yet</h2>
                    <p>Outputs saved in this workspace will appear here.</p>
                  </div>
                )}
              </div>
            ) : route === "overview" ? (
              <>
                <section className="welcome-surface">
                  <div className="welcome-mark" aria-hidden="true">
                    A
                  </div>
                  <h2>A clear place for your work.</h2>
                  <p>
                    Keep requests, decisions and your tools together. You stay
                    in control of approvals and consequential actions.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setRoute("settings")}
                  >
                    Open connections
                  </button>
                  <button onClick={() => setRoute("conversations")}>
                    Open conversations
                  </button>
                </section>
                <div className="overview-sections">
                  <section>
                    <h2>
                      Needs your attention{" "}
                      <span className="count">{queue.length}</span>
                    </h2>
                    {queue.slice(0, 3).map((item) => (
                      <button
                        className="overview-request"
                        key={item.id}
                        onClick={() => navigate(item)}
                      >
                        <span>{item.ask}</span>
                        <Icon name="chevron" />
                      </button>
                    ))}
                    {!queue.length && (
                      <p className="muted">Nothing needs you right now.</p>
                    )}
                  </section>
                  <section>
                    <h2>Recent outputs</h2>
                    {artifacts.slice(0, 3).map((item) => (
                      <button
                        className="overview-request"
                        key={item.id}
                        onClick={() => openArtifact(item)}
                      >
                        {item.ref.split("/").pop()}
                      </button>
                    ))}
                    {!artifacts.length && (
                      <p className="muted">
                        Your workspace outputs will appear here.
                      </p>
                    )}
                  </section>
                </div>
              </>
            ) : route === "agents" ? (
              <AgentsPanel />
            ) : (
              <div className="empty-state">
                <Icon name={route} />
                <h2>{routeLabel}</h2>
                <p>This workflow is not available in the foundation preview.</p>
              </div>
            )}
          </main>
          {layout.inspector && (
            <aside className="inspector" aria-label="Inspector">
              <div
                className="inspector-tabs"
                role="tablist"
                aria-label="Inspector tabs"
              >
                <button
                  role="tab"
                  aria-selected={layout.inspector === "issue"}
                  onClick={() => dispatch({ type: "inspect", tab: "issue" })}
                >
                  Issue
                </button>
                <button
                  role="tab"
                  aria-selected={layout.inspector === "web"}
                  onClick={() => dispatch({ type: "inspect", tab: "web" })}
                >
                  Web
                </button>
                <button
                  className="icon-button"
                  aria-label="Close inspector"
                  onClick={() => dispatch({ type: "inspect", tab: null })}
                >
                  <Icon name="close" />
                </button>
              </div>
              {layout.inspector === "issue" ? (
                request ? (
                  <div className="issue-detail">
                    <span className="type-label">
                      {attentionLabels[request.type]}
                    </span>
                    <h2>{request.ask}</h2>
                    <p className="muted">{request.origin.label}</p>
                    <p>{request.detail}</p>
                    {request.blocking.length > 0 && (
                      <div>
                        <h3>Blocking</h3>
                        <ul>
                          {request.blocking.map((ref) => (
                            <li key={ref}>{ref}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {request.state === "open" && (
                      <>
                        {request.governed || request.type === "approve" ? (
                          <div className="approval-note">
                            This request needs its dedicated approval review.
                            Opening it does not approve or execute it.
                          </div>
                        ) : (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              command("resolve", {
                                id: request.id,
                                source: "review",
                                ...(request.type === "answer"
                                  ? { answer }
                                  : {}),
                              });
                            }}
                          >
                            {request.type === "answer" && (
                              <label>
                                Your answer
                                <textarea
                                  value={answer}
                                  onChange={(event) =>
                                    setAnswer(event.target.value)
                                  }
                                  maxLength={16384}
                                />
                              </label>
                            )}
                            <button
                              className="primary"
                              disabled={
                                request.type === "answer" && !answer.trim()
                              }
                            >
                              {request.type === "answer"
                                ? "Save answer"
                                : "Mark reviewed"}
                            </button>
                          </form>
                        )}
                        <button
                          className="text-button"
                          onClick={() => snooze(request)}
                        >
                          Later — snooze for one hour
                        </button>
                      </>
                    )}
                    <p className="muted">
                      {request.state === "resolved"
                        ? "Resolved. Kept in Requests history."
                        : "Navigating away keeps this request open."}
                    </p>
                  </div>
                ) : artifact ? (
                  <div className="issue-detail">
                    <h2>{artifact.ref.split("/").pop()}</h2>
                    <p>{artifact.kind}</p>
                    <p className="artifact-reference">{artifact.ref}</p>
                    <button onClick={() => pinArtifact(artifact)}>
                      Pin artifact
                    </button>
                  </div>
                ) : (
                  <p className="empty-copy">
                    Select a request or artifact to see its details.
                  </p>
                )
              ) : (
                <div className="web-inspector">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      browser({ action: "navigate", url: previewURL });
                    }}
                  >
                    <label>
                      Preview URL
                      <input
                        type="url"
                        required
                        value={previewURL}
                        onChange={(event) => setPreviewURL(event.target.value)}
                      />
                    </label>
                    <div className="button-row">
                      <button type="submit">Open preview</button>
                      <button
                        type="button"
                        onClick={() => browser({ action: "back" })}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => browser({ action: "reload" })}
                      >
                        Reload
                      </button>
                    </div>
                  </form>
                  <p className="preview-status">{previewStatus}</p>
                  {handoff && (
                    <div className="handoff-note">
                      <p>
                        Sign in to {handoff.host} in your browser. This does not
                        sign the preview in.
                      </p>
                      <button
                        onClick={() =>
                          browser({
                            action: "handoff",
                            id: handoff.id,
                            target: "chrome",
                          })
                        }
                      >
                        Open in Chrome
                      </button>
                    </div>
                  )}
                  <div className="preview-viewport" ref={previewRef} />
                </div>
              )}
            </aside>
          )}
        </div>
        <footer className="composer">
          <Icon name="send" />
          <label className="sr-only" htmlFor="composer-input">
            Ask Firstmate
          </label>
          <input
            id="composer-input"
            placeholder={
              request ? "Ask Firstmate about this request…" : "Ask Firstmate…"
            }
            disabled
          />
          <span className="composer-context">
            {request ? "Request selected" : "No Firstmate session attached"}
          </span>
          <button
            className="primary icon-button"
            aria-label="Send to Firstmate"
            disabled
          >
            <Icon name="send" />
          </button>
        </footer>
        {layout.terminal && (
          <TerminalPane onClose={() => dispatch({ type: "terminal" })} />
        )}
      </div>
      <aside className="status-rail" aria-label="Status rail">
        {drawers.map(([id, label, icon], index) => (
          <button
            className={layout.drawer === id ? "active" : ""}
            key={id}
            aria-label={label + " drawer"}
            title={`${label} · ⌥⌘${index + 1}`}
            aria-expanded={layout.drawer === id}
            disabled={layout.focus}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") hover(id);
            }}
            onPointerLeave={leave}
            onClick={(event) => pin(id, event.currentTarget)}
          >
            <Icon name={icon} />
            {id === "activity" && activities.length > 0 && (
              <span className="rail-count">{activities.length}</span>
            )}
            {id === "notifications" &&
              notifications.some((item) => !item.readAt) && (
                <span className="unread-dot" />
              )}
          </button>
        ))}
      </aside>
      {layout.drawer && (
        <aside
          className="drawer"
          data-testid="drawer"
          ref={drawerRef}
          role="dialog"
          aria-label={drawers.find(([id]) => id === layout.drawer)?.[1]}
          aria-modal="false"
          onPointerEnter={() => {
            clearTimeout(closeTimer.current);
            clearTimeout(hoverTimer.current);
          }}
          onPointerLeave={leave}
        >
          <header>
            <h2 tabIndex={-1} data-drawer-heading>
              {drawers.find(([id]) => id === layout.drawer)?.[1]}
            </h2>
            <button
              className="icon-button"
              aria-label={layout.pinned ? "Unpin drawer" : "Pin drawer"}
              onClick={(event) => pin(layout.drawer!, event.currentTarget)}
            >
              <Icon name="pin" />
            </button>
            <button
              className="icon-button"
              aria-label="Close drawer"
              onClick={closeDrawer}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="drawer-body">{drawerBody(layout.drawer)}</div>
        </aside>
      )}
      <dialog
        className="command-palette"
        ref={paletteRef}
        aria-label="Command palette"
        onCancel={() => setPalette(false)}
      >
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            aria-label="Search entities and commands"
            placeholder="Search or run a command…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="icon-button"
            aria-label="Close command palette"
            onClick={() => setPalette(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="palette-results">
          {[
            ...navigation,
            ...tools,
            ["settings", "Settings"],
            ["conversations", "Conversations"],
            ["focus", "Toggle Focus"],
          ]
            .filter(([, label]) =>
              label.toLowerCase().includes(query.toLowerCase()),
            )
            .map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setPalette(false);
                  if (id === "focus") focus();
                  else tool(id!);
                }}
              >
                <Icon name={id!} />
                <span>{label}</span>
                <small>Command</small>
              </button>
            ))}
          {state.searchQuery === query &&
            state.search.map((item) => (
              <button
                key={item.kind + item.id}
                onClick={() => {
                  setPalette(false);
                  const request = snapshot?.attention.find(
                    (request) => request.id === item.id,
                  );
                  if (request) navigate(request);
                  else {
                    setRoute(
                      item.kind === "artifact"
                        ? "artifacts"
                        : item.kind === "product"
                          ? "overview"
                          : item.kind === "run"
                            ? "agents"
                            : item.kind === "decision"
                              ? "decisions"
                              : item.kind === "prd"
                                ? "prd"
                                : "backlog",
                    );
                    const found = artifacts.find(
                      (artifact) => artifact.id === item.id,
                    );
                    if (found) openArtifact(found);
                  }
                }}
              >
                <Icon name="search" />
                <span>{item.title}</span>
                <small>{item.kind.replaceAll("_", " ")}</small>
              </button>
            ))}
        </div>
      </dialog>
      <AuthPrompt />
    </div>
  );
}
export function startShell() {
  initializeBridge();
  const root = document.getElementById("root");
  if (!root) throw Error("Missing application root");
  createRoot(root).render(<App />);
}
