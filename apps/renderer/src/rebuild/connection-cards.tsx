// Settings › Tools: one card per outside service (Azure DevOps, GitHub,
// Notion, Obsidian). Same bridge messages and checks as the earlier
// Connections tab; only the view is new.
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { obsidianEndpoints } from "../../../../packages/contracts/src/auth.ts";
import { bridge } from "../bridge.ts";
import { Icon } from "../icons.tsx";

type Kind = "ado" | "github" | "notion" | "obsidian";
const services: {
  kind: Kind;
  name: string;
  purpose: string;
  defaultUrl: string;
}[] = [
  {
    kind: "ado",
    name: "Azure DevOps",
    purpose: "Read and update your team’s work items, repositories and wiki.",
    defaultUrl: "",
  },
  {
    kind: "notion",
    name: "Notion",
    purpose: "Publish pages to Notion once you approve them.",
    defaultUrl: "https://api.notion.com",
  },
  {
    kind: "github",
    name: "GitHub",
    purpose: "Read repositories and pull requests.",
    defaultUrl: "https://github.com",
  },
  {
    kind: "obsidian",
    name: "Obsidian",
    purpose: "Read and save notes in your vault.",
    defaultUrl: obsidianEndpoints[0],
  },
];
type View = { tone: string; icon: string; text: string };
const views: Record<string, View> = {
  missing: { tone: "signed-out", icon: "warning", text: "Not connected" },
  configured: {
    tone: "signed-out",
    icon: "warning",
    text: "Saved, not tested",
  },
  checking: { tone: "checking", icon: "checking", text: "Checking…" },
  ready: { tone: "connected", icon: "check", text: "Connected" },
  error: { tone: "error", icon: "close", text: "Not working" },
  cancelled: { tone: "signed-out", icon: "warning", text: "Sign-in cancelled" },
};
const viewOf = (status: string | undefined) =>
  views[(status ?? "missing").toLowerCase()] ?? views.missing!;
const failure = (name: string, reason: string) =>
  `Couldn’t connect to ${name}: ${reason}. Check the server address and your access, then try again.`;
const auth = (command: Record<string, unknown>) =>
  bridge.send({ version: 1, kind: "auth", ...command });

function SaveForm({
  kind,
  name,
  defaultUrl,
  onDone,
}: {
  kind: Exclude<Kind, "notion">;
  name: string;
  defaultUrl: string;
  onDone(): void;
}) {
  const [baseUrl, setBaseUrl] = useState(defaultUrl);
  const key = useRef<HTMLInputElement>(null);
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!key.current) return;
    const secret = key.current.value;
    key.current.value = "";
    auth({ action: "save", connection: { kind, baseUrl }, secret });
    onDone();
  };
  return (
    <form
      onSubmit={save}
      style={{ display: "grid", gap: 8, gridColumn: "1 / -1" }}
    >
      {kind === "obsidian" ? (
        <>
          <p className="muted small">
            Turn on Local REST API with MCP in Obsidian, then copy its key from
            the plugin settings.
          </p>
          <label className="field">
            Plugin address
            <select
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            >
              <option value={obsidianEndpoints[0]}>
                Secure · {obsidianEndpoints[0]}
              </option>
              <option value={obsidianEndpoints[1]}>
                Local only · {obsidianEndpoints[1]}
              </option>
            </select>
          </label>
          <p className="muted small">
            The secure address needs a certificate your Mac trusts. Pick local
            only after turning that option on in Obsidian.
          </p>
        </>
      ) : (
        <label className="field">
          {kind === "ado" ? "Organisation or collection address" : "Address"}
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={
              kind === "ado" ? "https://dev.azure.com/your-organisation" : ""
            }
          />
        </label>
      )}
      <label className="field">
        {kind === "obsidian" ? "Obsidian plugin key" : "Access token"}
        <input
          type="password"
          required
          autoComplete="off"
          ref={key}
          maxLength={65536}
        />
      </label>
      <p className="muted small">
        Kept in your Mac’s Keychain. Signing in through a browser does not give
        Amun access to {name}, so paste a token instead.
      </p>
      <span className="row">
        <button className="btn">Save connection</button>
        <button type="button" className="btn quiet" onClick={onDone}>
          Cancel
        </button>
      </span>
    </form>
  );
}

function NotionControls({ status }: { status: string | undefined }) {
  const [browser, setBrowser] = useState<"edge" | "dia">("edge");
  const [target, setTarget] = useState("");
  const [confirming, setConfirming] = useState(false);
  const checking = status === "checking";
  return (
    <div style={{ display: "grid", gap: 8, gridColumn: "1 / -1" }}>
      <p className="muted small">
        You sign in and pick your workspace in your browser. Amun never asks you
        to paste a token.
      </p>
      <label className="field">
        Sign-in browser
        <select
          value={browser}
          onChange={(event) => setBrowser(event.target.value as "edge" | "dia")}
        >
          <option value="edge">Microsoft Edge</option>
          <option value="dia">Dia</option>
        </select>
      </label>
      <span className="row wrap">
        <button
          className="btn"
          disabled={checking}
          onClick={() => auth({ action: "notion-connect", browser })}
        >
          Connect Notion in browser
        </button>
        <button
          className="btn quiet"
          onClick={() => auth({ action: "notion-check" })}
        >
          Test Notion connection
        </button>
        {checking && (
          <button
            className="btn quiet"
            onClick={() => auth({ action: "notion-cancel" })}
          >
            Cancel Notion sign-in
          </button>
        )}
        <button className="btn quiet" onClick={() => setConfirming(true)}>
          Disconnect Notion
        </button>
      </span>
      {confirming && (
        <div role="group" aria-label="Confirm Notion disconnect">
          <p className="small">
            Remove this workspace’s saved Notion sign-in and destination? Pages
            already published stay in Notion.
          </p>
          <span className="row">
            <button
              className="btn"
              onClick={() => {
                setConfirming(false);
                setTarget("");
                auth({ action: "notion-disconnect" });
              }}
            >
              Confirm disconnect
            </button>
            <button className="btn quiet" onClick={() => setConfirming(false)}>
              Keep connection
            </button>
          </span>
        </div>
      )}
      <label className="field">
        Notion page to publish under
        <input
          type="url"
          value={target}
          maxLength={2048}
          placeholder="Paste the page’s link"
          onChange={(event) => setTarget(event.target.value)}
        />
      </label>
      <span className="row">
        <button
          className="btn quiet"
          disabled={!target || checking}
          onClick={() => auth({ action: "notion-target", url: target })}
        >
          Check Notion destination
        </button>
      </span>
    </div>
  );
}

export function ConnectionCards() {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {services.map((service) => {
        const mine = state.connections.filter(
          (item) => item.kind === service.kind,
        );
        const notion = service.kind === "notion";
        const status = notion
          ? (state.modelStatus["notion-mcp"] ?? mine[0]?.status)
          : mine.some((item) => item.status === "error")
            ? "error"
            : mine.length
              ? mine.every((item) => item.status === "ready")
                ? "ready"
                : mine.some((item) => item.status === "checking")
                  ? "checking"
                  : "configured"
              : "missing";
        const view = viewOf(status);
        return (
          <div className="rb-provider" key={service.kind}>
            <strong>{service.name}</strong>
            <span
              className={"status " + view.tone}
              role="status"
              aria-live="polite"
            >
              <Icon name={view.icon} width={15} height={15} />
              {view.text}
            </span>
            <span className="muted small">{service.purpose}</span>
            {!notion && adding !== service.kind ? (
              <button className="btn" onClick={() => setAdding(service.kind)}>
                {mine.length ? "Add another" : "Connect"}
              </button>
            ) : (
              <span />
            )}
            {view.tone === "error" && (
              <p
                className="rb-notice error"
                role="alert"
                style={{ gridColumn: "1 / -1", margin: 0 }}
              >
                <span>
                  {failure(
                    service.name,
                    state.notice
                      ? state.notice.replace(/[.\s]+$/, "")
                      : "the service did not accept the sign-in",
                  )}
                </span>
              </p>
            )}
            {notion ? (
              <NotionControls status={status} />
            ) : (
              mine.map((item) => (
                <div
                  className="row wrap"
                  key={item.id}
                  style={{ gridColumn: "1 / -1" }}
                >
                  <span className="muted small grow">
                    {item.baseUrl} · {viewOf(item.status).text}
                  </span>
                  {confirming === item.id ? (
                    <span
                      className="row wrap"
                      role="group"
                      aria-label={`Confirm disconnect ${service.name}`}
                    >
                      <span className="small">
                        Remove the saved sign-in for {item.baseUrl}?
                      </span>
                      <button
                        className="btn"
                        onClick={() => {
                          setConfirming(null);
                          auth({
                            action: "forget",
                            connection: {
                              kind: item.kind,
                              baseUrl: item.baseUrl,
                            },
                          });
                        }}
                      >
                        Confirm disconnect
                      </button>
                      <button
                        className="btn quiet"
                        onClick={() => setConfirming(null)}
                      >
                        Keep connection
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        className="btn quiet"
                        onClick={() =>
                          auth({
                            action: "check",
                            connection: {
                              kind: item.kind,
                              baseUrl: item.baseUrl,
                            },
                          })
                        }
                      >
                        Test connection
                      </button>
                      <button
                        className="btn quiet"
                        onClick={() => setConfirming(item.id)}
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
            {!notion && adding === service.kind && (
              <SaveForm
                kind={service.kind as Exclude<Kind, "notion">}
                name={service.name}
                defaultUrl={service.defaultUrl}
                onDone={() => setAdding(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
