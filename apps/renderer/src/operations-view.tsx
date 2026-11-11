import {
  originLabels,
  pluginOrigins,
  type PluginManifest,
} from "../../../packages/domain/src/plugins.ts";

export interface ClaimRow {
  task: { kind: string; id: string };
  state: string;
  holder: { kind: string; id: string } | null;
  activity: string;
  acquiredAt: string | null;
  heldForMs: number | null;
  stalled: boolean;
}

const stateLabels: Record<string, string> = {
  available: "Available",
  claimed: "In progress",
  waiting_human: "Waiting for a person",
  waiting_dependency: "Waiting for a dependency",
  failed: "Failed",
  paused: "Paused",
  completed: "Completed",
};

function held(ms: number | null): string {
  if (ms === null) return "";
  const minutes = Math.floor(ms / 60000);
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Who holds each task, what they are doing and for how long. */
export function ClaimsView({
  claims,
  onReclaim,
}: {
  claims: readonly ClaimRow[];
  onReclaim?(task: { kind: string; id: string }): void;
}) {
  return (
    <section className="claims" aria-label="Task ownership">
      <h2>Task ownership</h2>
      {claims.length === 0 ? (
        <p className="muted">No task is held right now.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">State</th>
              <th scope="col">Held by</th>
              <th scope="col">Doing</th>
              <th scope="col">Held for</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr
                key={claim.task.kind + ":" + claim.task.id}
                data-task-id={claim.task.id}
                data-stalled={claim.stalled}
              >
                <th scope="row">{claim.task.id}</th>
                <td>
                  {claim.stalled
                    ? "Stalled, no update from holder"
                    : (stateLabels[claim.state] ?? claim.state)}
                </td>
                <td>
                  {claim.holder
                    ? `${claim.holder.id} (${claim.holder.kind})`
                    : "Nobody"}
                </td>
                <td>{claim.activity}</td>
                <td>{held(claim.heldForMs)}</td>
                <td>
                  {claim.holder && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onReclaim?.(claim.task)}
                    >
                      Reclaim {claim.task.id}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export interface WakeRow {
  id: string;
  at: string;
  trigger: string;
  reason: string;
  decision: string;
  detail: string;
  waitingOn: string | null;
}

const decisionLabels: Record<string, string> = {
  act: "Acted",
  wait: "Waited",
  delegate: "Delegated",
  escalate: "Escalated",
  request_approval: "Asked for approval",
  refused: "Stopped",
};

/** Why an agent woke, what it decided, what it waits on and when it acts next. */
export function HeartbeatView({
  agentName,
  wakes,
  waitingOn,
  nextAt,
  haltedReason,
  onHalt,
  onRelease,
}: {
  agentName: string;
  wakes: readonly WakeRow[];
  waitingOn: string | null;
  nextAt: string | null;
  haltedReason: string | null;
  onHalt?(): void;
  onRelease?(): void;
}) {
  return (
    <section className="heartbeat" aria-label={"Activity of " + agentName}>
      <h2>{agentName}</h2>
      <p className="heartbeat-state" data-halted={haltedReason !== null}>
        {haltedReason
          ? "Halted · " + haltedReason
          : nextAt
            ? "Next check " + nextAt
            : "No check scheduled"}
        {waitingOn && " · Waiting on " + waitingOn}
      </p>
      <button
        type="button"
        className="text-button"
        onClick={haltedReason ? onRelease : onHalt}
      >
        {haltedReason ? `Let ${agentName} continue` : `Halt ${agentName}`}
      </button>
      {wakes.length === 0 ? (
        <p className="muted">This agent has not woken yet.</p>
      ) : (
        <ol className="heartbeat-wakes">
          {wakes.map((wake) => (
            <li key={wake.id} data-decision={wake.decision}>
              <time dateTime={wake.at}>{wake.at}</time>
              <p>
                Woke because: {wake.reason} ({wake.trigger.replace("_", " ")})
              </p>
              <p>
                {decisionLabels[wake.decision] ?? wake.decision}: {wake.detail}
              </p>
              {wake.waitingOn && <p>Waiting on: {wake.waitingOn}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export interface PluginRow {
  manifest: PluginManifest;
  state: string;
  granted: boolean;
  compatible: boolean;
  permissions: readonly string[];
}

const kindLabels: Record<string, string> = {
  model_provider: "Model provider",
  connector: "Connector",
  skill: "Skill",
  workflow: "Workflow",
  interface: "Interface",
  policy: "Policy",
};

/** Installed extensions grouped by where they come from. */
export function PluginCatalogView({
  plugins,
  onToggle,
  onRemove,
}: {
  plugins: readonly PluginRow[];
  onToggle?(id: string, enable: boolean): void;
  onRemove?(id: string): void;
}) {
  return (
    <section className="plugins" aria-label="Extensions">
      <h2>Extensions</h2>
      {plugins.length === 0 && (
        <p className="muted">No extensions are installed.</p>
      )}
      {pluginOrigins.map((origin) => {
        const group = plugins.filter((p) => p.manifest.origin === origin);
        if (group.length === 0) return null;
        return (
          <section key={origin} aria-label={originLabels[origin]}>
            <h3>{originLabels[origin]}</h3>
            <ul>
              {group.map(({ manifest, state, compatible, permissions }) => (
                <li key={manifest.id} data-plugin-id={manifest.id}>
                  <strong>{manifest.name}</strong>
                  <span className="type-label">
                    {kindLabels[manifest.kind]}
                  </span>
                  <span>Version {manifest.version}</span>
                  <span>{state === "enabled" ? "On" : "Off"}</span>
                  {!compatible && (
                    <span>Not compatible with this version of Amun</span>
                  )}
                  <p>{manifest.description}</p>
                  <ul aria-label={"Access needed by " + manifest.name}>
                    {permissions.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!compatible && state !== "enabled"}
                    onClick={() => onToggle?.(manifest.id, state !== "enabled")}
                  >
                    {state === "enabled"
                      ? `Turn off ${manifest.name}`
                      : `Review access and turn on ${manifest.name}`}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onRemove?.(manifest.id)}
                  >
                    Remove {manifest.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
