// Agent tools already on this Mac: what was found, whether it is ready, and
// the one thing to do next. Amun looks them up and runs only each tool's
// version command; nothing is sent anywhere.
import { useEffect, useState } from "react";
import {
  toolsReport,
  type ToolsReport,
} from "../../../../packages/contracts/src/work.ts";
import { toolStatusLabels } from "../../../../packages/domain/src/tool-detection.ts";
import { bridge } from "../bridge.ts";
import { Icon } from "../icons.tsx";

type Tool = ToolsReport["tools"][number];
const send = (command: Record<string, unknown>) =>
  bridge.send({ version: 1, kind: "tools", ...command });
const tone: Record<Tool["status"], string> = {
  ready: "connected",
  needs_sign_in: "signed-out",
  outdated: "signed-out",
  blocked: "error",
  disabled: "checking",
  not_installed: "checking",
};
const icon: Record<Tool["status"], string> = {
  ready: "check",
  needs_sign_in: "warning",
  outdated: "warning",
  blocked: "close",
  disabled: "close",
  not_installed: "close",
};
/** Tools that can do delegated work, as opposed to ones Amun merely needs. */
const helpers = new Set(["tmux", "git"]);

export function ToolCards() {
  const [report, setReport] = useState<ToolsReport | null>(null);
  const [looking, setLooking] = useState(true);
  const [missing, setMissing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  useEffect(() => {
    const stop = bridge.onEvent((raw) => {
      const event = toolsReport.safeParse(raw);
      if (!event.success) return;
      setReport(event.data);
      setLooking(false);
    });
    send({ action: "refresh" });
    return stop;
  }, []);
  const refresh = () => {
    setLooking(true);
    send({ action: "refresh" });
  };
  const tools = report?.tools ?? [];
  const found = tools.filter((tool) => tool.status !== "not_installed");
  const absent = tools.filter((tool) => tool.status === "not_installed");
  const row = (tool: Tool) => (
    <div className="rb-provider" key={tool.id}>
      <strong>
        {tool.label}
        {tool.version && (
          <span className="muted" style={{ fontWeight: 400 }}>
            {" "}
            {tool.version}
          </span>
        )}
        {tool.isDefault && (
          <span className="tag accent" style={{ marginLeft: 8 }}>
            Default
          </span>
        )}
      </strong>
      <span className={"status " + tone[tool.status]}>
        <Icon name={icon[tool.status]} width={15} height={15} />
        {toolStatusLabels[tool.status]}
      </span>
      <span className="muted small">
        {tool.status === "ready" ? tool.access : tool.nextAction}
      </span>
      <span className="row">
        {tool.status === "ready" &&
          !tool.isDefault &&
          !helpers.has(tool.id) && (
            <button
              className="btn quiet"
              onClick={() => send({ action: "default", id: tool.id })}
            >
              Make default
            </button>
          )}
        {tool.status !== "not_installed" && !helpers.has(tool.id) && (
          <button
            className="btn quiet"
            onClick={() =>
              send({
                action: "enable",
                id: tool.id,
                enabled: tool.status === "disabled",
              })
            }
          >
            {tool.status === "disabled" ? "Turn on" : "Turn off"}
          </button>
        )}
        {tool.origin === "manual" && (
          <button
            className="btn quiet"
            onClick={() => send({ action: "remove", id: tool.id })}
          >
            Remove
          </button>
        )}
      </span>
    </div>
  );
  return (
    <section style={{ display: "grid", gap: 8 }} aria-labelledby="rb-tools-h">
      <div className="row">
        <h2 id="rb-tools-h">Tools already on this Mac</h2>
        <span className="grow" />
        <button className="btn quiet" disabled={looking} onClick={refresh}>
          {looking ? "Looking…" : "Look again"}
        </button>
      </div>
      <p className="muted small">
        Amun only checks each tool’s version. Firstmate hands work to the ones
        you leave on.
      </p>
      {report?.message && (
        <p className="rb-notice" role="alert">
          <span>{report.message}</span>
        </p>
      )}
      {found.map(row)}
      {!looking && !found.length && (
        <p className="muted">No agent tools were found on this Mac.</p>
      )}
      {absent.length > 0 && (
        <button
          className="link"
          style={{ justifySelf: "start" }}
          aria-expanded={missing}
          onClick={() => setMissing(!missing)}
        >
          {missing ? "Hide" : "Show"} {absent.length} not installed
        </button>
      )}
      {missing && absent.map(row)}
      {adding ? (
        <form
          className="row wrap"
          onSubmit={(event) => {
            event.preventDefault();
            send({ action: "add", label: label.trim(), path: path.trim() });
            setLabel("");
            setPath("");
            setAdding(false);
          }}
        >
          <input
            type="text"
            aria-label="Tool name"
            placeholder="Name, e.g. My agent"
            value={label}
            maxLength={64}
            onChange={(event) => setLabel(event.target.value)}
          />
          <input
            type="text"
            className="grow"
            aria-label="Full path to the tool"
            placeholder="/full/path/to/the/tool"
            value={path}
            maxLength={1024}
            onChange={(event) => setPath(event.target.value)}
          />
          <button
            className="btn"
            disabled={!label.trim() || !path.trim().startsWith("/")}
          >
            Add
          </button>
          <button
            type="button"
            className="btn quiet"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="link"
          style={{ justifySelf: "start" }}
          onClick={() => setAdding(true)}
        >
          Add a tool that was not found
        </button>
      )}
    </section>
  );
}
