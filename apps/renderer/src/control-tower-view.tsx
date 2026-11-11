import type {
  CapacityRow,
  LiveOperations,
  OperatorAction,
  QualityReport,
  RankedAttention,
  ScheduleRow,
} from "../../../packages/domain/src/operations.ts";
import { headline } from "../../../packages/domain/src/operations.ts";
import type {
  FleetOverview,
  FleetTask,
} from "../../../packages/domain/src/fleet.ts";
import {
  toolStatusLabels,
  type ToolReport,
} from "../../../packages/domain/src/tool-detection.ts";
import {
  portBadge,
  type ServiceHealth,
} from "../../../packages/domain/src/lifecycle.ts";

const stateLabels: Record<string, string> = {
  active: "Active",
  queued: "Queued",
  waiting: "Waiting",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
const actionLabels: Record<OperatorAction, string> = {
  approve: "Approve",
  reject: "Reject",
  reassign: "Reassign",
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel",
};
const healthLabels: Record<string, string> = {
  on_time: "On time",
  delayed: "Delayed",
  missed: "Missed",
  failing: "Failing repeatedly",
  paused: "Paused",
};

function minutes(ms: number): string {
  const total = Math.floor(ms / 60000);
  return total < 60
    ? `${total} min`
    : `${Math.floor(total / 60)} h ${total % 60} min`;
}
const percent = (value: number | null) =>
  value === null ? "No data" : Math.round(value * 100) + "%";

/** One screen for what is happening, what needs you, what is at risk and what got done. */
export function ControlTower(props: {
  live: LiveOperations;
  attention: readonly RankedAttention[];
  schedules: readonly ScheduleRow[];
  capacity: readonly CapacityRow[];
  quality: QualityReport;
  onOpenSession?(sessionId: string): void;
  onAct?(itemId: string, action: OperatorAction): void;
}) {
  const summary = headline(
    props.live,
    props.attention,
    props.capacity,
    props.quality,
  );
  return (
    <section className="control-tower" aria-label="Operations">
      <h2>Operations</h2>
      <dl className="tower-headline">
        <dt>Happening now</dt>
        <dd>{summary.now}</dd>
        <dt>Needs attention</dt>
        <dd>{summary.attention}</dd>
        <dt>At risk</dt>
        <dd>{summary.risk}</dd>
        <dt>Accomplished</dt>
        <dd>{summary.accomplished}</dd>
      </dl>

      <section aria-label="Attention queue">
        <h3>Attention queue</h3>
        {props.attention.length === 0 ? (
          <p className="muted">Nothing needs you right now.</p>
        ) : (
          <ol>
            {props.attention.map((item) => (
              <li
                key={item.id}
                data-attention-id={item.id}
                data-overdue={item.overdue}
              >
                <span className="type-label">
                  {item.kind.replace("_", " ")}
                </span>
                <span>{item.title}</span>
                {item.overdue && <span>Overdue</span>}
                {item.customerImpact && <span>Affects a customer</span>}
                {item.sessionId && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => props.onOpenSession?.(item.sessionId!)}
                  >
                    Open trajectory for {item.title}
                  </button>
                )}
                {item.actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="text-button"
                    onClick={() => props.onAct?.(item.id, action)}
                  >
                    {actionLabels[action]} {item.title}
                  </button>
                ))}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Live operations">
        <h3>Live operations</h3>
        {props.live.rows.length === 0 ? (
          <p className="muted">No agent sessions yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">State</th>
                <th scope="col">Stage</th>
                <th scope="col">Owner</th>
                <th scope="col">Running for</th>
                <th scope="col">Last activity</th>
                <th scope="col">Next action</th>
              </tr>
            </thead>
            <tbody>
              {props.live.rows.map((row) => (
                <tr
                  key={row.id}
                  data-session-id={row.id}
                  data-stuck={row.stuck}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => props.onOpenSession?.(row.id)}
                    >
                      {row.title}
                    </button>
                  </th>
                  <td>
                    {row.stuck
                      ? "Stuck, no recent activity"
                      : stateLabels[row.state]}
                  </td>
                  <td>{row.stage}</td>
                  <td>{row.owner}</td>
                  <td>{minutes(row.durationMs)}</td>
                  <td>{minutes(row.idleMs)} ago</td>
                  <td>{row.nextAction ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Scheduled work">
        <h3>Scheduled work</h3>
        {props.schedules.length === 0 ? (
          <p className="muted">Nothing is scheduled.</p>
        ) : (
          <ul>
            {props.schedules.map((task) => (
              <li key={task.id} data-health={task.health}>
                {task.name} · {task.schedule} · {task.owner} ·{" "}
                {healthLabels[task.health]}
                {task.lateByMs > 0 && ` by ${minutes(task.lateByMs)}`}
                {" · Last success: "}
                {task.lastSuccessAt ?? "never"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Capacity and limits">
        <h3>Capacity and limits</h3>
        {props.capacity.length === 0 ? (
          <p className="muted">No limits are reported.</p>
        ) : (
          <ul>
            {props.capacity.map((row) => (
              <li key={row.name} data-level={row.level}>
                {row.name}: {row.used} of {row.limit} · {row.explanation}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Quality and reliability">
        <h3>Quality and reliability</h3>
        <p>
          {props.quality.sessions} sessions · Success{" "}
          {percent(props.quality.successRate)} · Retried{" "}
          {percent(props.quality.retryRate)} · Needed a person{" "}
          {percent(props.quality.interventionRate)} · Approvals granted{" "}
          {percent(props.quality.approvalRate)}
        </p>
        {props.quality.failures.map((failure) => (
          <p key={failure.sessionId}>
            <button
              type="button"
              className="text-button"
              onClick={() => props.onOpenSession?.(failure.sessionId)}
            >
              Open failed session {failure.sessionId}
            </button>{" "}
            {failure.remediation}
          </p>
        ))}
      </section>
    </section>
  );
}

const taskLabels: Record<string, string> = {
  pending: "Waiting to start",
  running: "Working",
  blocked: "Has a question",
  failed: "Failed",
  done: "Finished, not merged",
  merged: "Merged",
};

/** A supervisor's plan with one tile per worker. */
export function FleetView(props: {
  objective: string;
  supervisor: string;
  overview: FleetOverview;
  tasks: readonly FleetTask[];
}) {
  return (
    <section className="fleet" aria-label="Fleet overview">
      <h2>{props.objective}</h2>
      <p>
        Supervisor {props.supervisor} ·{" "}
        {Math.round(props.overview.progress * 100)}% finished ·{" "}
        {props.overview.counts.running} working ·{" "}
        {props.overview.needsAttention.length} need attention
        {props.overview.readyToIntegrate && " · Ready for integration tests"}
      </p>
      <ul className="fleet-tiles">
        {props.tasks.map((task) => (
          <li key={task.id} data-task-id={task.id} data-state={task.state}>
            <strong>{task.title}</strong>
            <span className="type-label">{taskLabels[task.state]}</span>
            <span>{task.worker ?? "No worker yet"}</span>
            {task.branch && <span>{task.branch}</span>}
            {task.dependsOn.length > 0 && (
              <span>After: {task.dependsOn.join(", ")}</span>
            )}
            {task.note && <span>{task.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Tools found on this Mac, each with its status and one next step. */
export function ToolSetupView(props: {
  tools: readonly ToolReport[];
  onRefresh?(): void;
  onToggle?(id: string, on: boolean): void;
}) {
  return (
    <section className="tool-setup" aria-label="Agent tools on this Mac">
      <h2>Agent tools on this Mac</h2>
      <button type="button" className="text-button" onClick={props.onRefresh}>
        Check again
      </button>
      <ul>
        {props.tools.map((tool) => (
          <li key={tool.id} data-tool-id={tool.id} data-status={tool.status}>
            <strong>{tool.label}</strong>
            <span className="type-label">{toolStatusLabels[tool.status]}</span>
            {tool.version && <span>Version {tool.version}</span>}
            {tool.isDefault && <span>Default</span>}
            {tool.origin === "manual" && <span>Added by you</span>}
            <p>{tool.access}</p>
            <p>{tool.dataShared}</p>
            <p>Next: {tool.nextAction}</p>
            {tool.status !== "not_installed" && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  props.onToggle?.(tool.id, tool.status === "disabled")
                }
              >
                {tool.status === "disabled"
                  ? `Turn on ${tool.label}`
                  : `Turn off ${tool.label}`}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The port badge on a task tab; a link while the service can be opened. */
export function PortBadge(props: {
  port: number | null;
  health: ServiceHealth;
  taskTitle: string;
}) {
  const badge = portBadge(props.port, props.health);
  const label = `${props.taskTitle} preview on ${badge.label}, ${badge.status}`;
  return badge.url ? (
    <a
      className="port-badge"
      href={badge.url}
      data-health={props.health}
      aria-label={label}
    >
      {badge.label}
    </a>
  ) : (
    <span className="port-badge" data-health={props.health} aria-label={label}>
      {badge.label}
    </span>
  );
}
