import type {
  OrgNode,
  OrgOverview,
} from "../../../packages/domain/src/agent-org.ts";

const statusLabels = {
  active: "Active",
  paused: "Paused",
  blocked: "Blocked",
  needs_attention: "Needs you",
  retired: "Retired",
} as const;

function money(micros: number): string {
  return (micros / 1_000_000).toFixed(2);
}

/** The agent organisation at a glance: who reports to whom and who answers for them. */
export function OrgChart({
  nodes,
  overview,
  spent = {},
  onOpen,
}: {
  nodes: readonly OrgNode[];
  overview: OrgOverview;
  /** Spend this period, in millionths, by agent id. */
  spent?: Readonly<Record<string, number>>;
  onOpen?(agentId: string): void;
}) {
  return (
    <section className="org-chart" aria-label="Agent organisation">
      <h2>Agents</h2>
      <p className="org-overview">
        {overview.total} agents · {overview.active} active · {overview.blocked}{" "}
        blocked · {overview.needsAttention} need you · {overview.paused} paused
      </p>
      {overview.unaccountable.length > 0 && (
        <p role="alert">
          {overview.unaccountable.length} agent has nobody accountable for it.
        </p>
      )}
      {nodes.length === 0 ? (
        <p className="muted">No agents are registered yet.</p>
      ) : (
        <ul className="org-tree">
          {nodes.map(({ agent, depth, accountable, reports }) => (
            <li
              key={agent.id}
              className={"org-agent status-" + agent.status}
              data-agent-id={agent.id}
              data-depth={depth}
              style={{ marginInlineStart: depth * 24 }}
            >
              <button
                type="button"
                className="text-button"
                onClick={() => onOpen?.(agent.id)}
              >
                {agent.displayName}
              </button>
              <span className="type-label">{statusLabels[agent.status]}</span>
              <span>
                {agent.title} · {agent.role} · {agent.runtime}
              </span>
              <span>Accountable: {accountable ?? "nobody"}</span>
              {reports > 0 && <span>{reports} direct reports</span>}
              {agent.budgetMicros !== null && (
                <span>
                  Budget {money(spent[agent.id] ?? 0)} of{" "}
                  {money(agent.budgetMicros)} per {agent.budgetPeriod}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface GoalRow {
  id: string;
  depth: number;
  level: string;
  title: string;
  category: string;
  status: string;
  linked: number;
  advanced: number;
  noEffect: number;
  setBack: number;
  unassessed: number;
}

/** Goals with the work beneath them and whether that work moved the goal. */
export function GoalsView({
  goals,
  onOpen,
}: {
  goals: readonly GoalRow[];
  onOpen?(goalId: string): void;
}) {
  return (
    <section className="goals" aria-label="Goals">
      <h2>Goals</h2>
      {goals.length === 0 ? (
        <p className="muted">No goals are defined yet.</p>
      ) : (
        <table>
          <caption>
            Finished work is counted separately from work that advanced the
            goal.
          </caption>
          <thead>
            <tr>
              <th scope="col">Goal</th>
              <th scope="col">Category</th>
              <th scope="col">Status</th>
              <th scope="col">Linked work</th>
              <th scope="col">Advanced</th>
              <th scope="col">No effect</th>
              <th scope="col">Set back</th>
              <th scope="col">Not assessed</th>
            </tr>
          </thead>
          <tbody>
            {goals.map((goal) => (
              <tr key={goal.id} data-goal-id={goal.id} data-depth={goal.depth}>
                <th scope="row" style={{ paddingInlineStart: goal.depth * 24 }}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOpen?.(goal.id)}
                  >
                    {goal.title}
                  </button>
                  <span className="type-label">{goal.level}</span>
                </th>
                <td>{goal.category}</td>
                <td>{goal.status}</td>
                <td>{goal.linked}</td>
                <td>{goal.advanced}</td>
                <td>{goal.noEffect}</td>
                <td>{goal.setBack}</td>
                <td>{goal.unassessed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
