/**
 * Agent organisation: every agent has an identity, a place in a reporting
 * line, a scope of what it may touch, a budget and an accountable person.
 */

export const agentStatuses = [
  "active",
  "paused",
  "blocked",
  "needs_attention",
  "retired",
] as const;
export type AgentStatus = (typeof agentStatuses)[number];

export const budgetPeriods = ["day", "week", "month", "total"] as const;
export type BudgetPeriod = (typeof budgetPeriods)[number];

/** What an agent may reach. An absent list means nothing of that kind. */
export interface AgentScopes {
  products?: readonly string[];
  tools?: readonly string[];
  actions?: readonly string[];
  data?: readonly string[];
}

export interface AgentSchedule {
  /** Days of the week the agent may work, 0 = Sunday. Absent means every day. */
  days?: readonly number[];
  /** Working hours in UTC, start inclusive and end exclusive. */
  fromHour?: number;
  toHour?: number;
}

export interface Agent {
  id: string;
  displayName: string;
  role: string;
  title: string;
  description: string;
  /** Where the agent runs, for example "claude_code", "codex", "pi" or "external". */
  runtime: string;
  /** The identifier of a customer-managed agent in its own system. */
  externalRef: string | null;
  /** The person or team answerable for this agent, when set directly. */
  accountableOwner: string | null;
  managerId: string | null;
  status: AgentStatus;
  scopes: AgentScopes;
  budgetMicros: number | null;
  budgetPeriod: BudgetPeriod | null;
  schedule: AgentSchedule;
  /** Who is told when the agent is blocked: an agent id or a person. */
  escalation: string | null;
}

/** The agent's managers, nearest first. Stops if a loop is found. */
export function managementChain(agents: readonly Agent[], id: string): Agent[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const chain: Agent[] = [];
  const seen = new Set([id]);
  let current = byId.get(id)?.managerId ?? null;
  while (current !== null && !seen.has(current)) {
    const manager = byId.get(current);
    if (!manager) break;
    chain.push(manager);
    seen.add(current);
    current = manager.managerId;
  }
  return chain;
}

/** True when making `managerId` the manager of `id` would form a loop. */
export function wouldLoop(
  agents: readonly Agent[],
  id: string,
  managerId: string | null,
): boolean {
  if (managerId === null) return false;
  if (managerId === id) return true;
  return managementChain(agents, managerId).some((agent) => agent.id === id);
}

/**
 * The person or team ultimately answerable for an agent: its own owner, or
 * the nearest owner up its reporting line. Null means nobody is accountable,
 * which the organisation must not allow.
 */
export function accountableFor(
  agents: readonly Agent[],
  id: string,
): string | null {
  const self = agents.find((agent) => agent.id === id);
  if (!self) return null;
  for (const agent of [self, ...managementChain(agents, id)])
    if (agent.accountableOwner) return agent.accountableOwner;
  return null;
}

export function directReports(agents: readonly Agent[], id: string): Agent[] {
  return agents.filter((agent) => agent.managerId === id);
}

export function peers(agents: readonly Agent[], id: string): Agent[] {
  const self = agents.find((agent) => agent.id === id);
  if (!self || self.managerId === null) return [];
  return agents.filter(
    (agent) => agent.managerId === self.managerId && agent.id !== id,
  );
}

export interface OrgNode {
  agent: Agent;
  depth: number;
  accountable: string | null;
  reports: number;
}

/** The hierarchy flattened top-down, managers before their reports. */
export function orgTree(agents: readonly Agent[]): OrgNode[] {
  const ids = new Set(agents.map((agent) => agent.id));
  const rows: OrgNode[] = [];
  const visit = (agent: Agent, depth: number, seen: Set<string>) => {
    if (seen.has(agent.id)) return;
    seen.add(agent.id);
    const reports = directReports(agents, agent.id);
    rows.push({
      agent,
      depth,
      accountable: accountableFor(agents, agent.id),
      reports: reports.length,
    });
    for (const report of [...reports].sort(byName))
      visit(report, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const top of agents
    .filter((a) => a.managerId === null || !ids.has(a.managerId))
    .sort(byName))
    visit(top, 0, seen);
  return rows;
}

function byName(left: Agent, right: Agent): number {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

export type ScopeKind = keyof AgentScopes;

/** An agent may act only on what its scope names; "*" allows every value. */
export function inScope(agent: Agent, kind: ScopeKind, value: string): boolean {
  const allowed = agent.scopes[kind] ?? [];
  return allowed.includes("*") || allowed.includes(value);
}

export type PermissionRefusal =
  | "retired"
  | "paused"
  | "outside_schedule"
  | "product_out_of_scope"
  | "tool_out_of_scope"
  | "action_out_of_scope"
  | "data_out_of_scope"
  | "over_budget"
  | "unaccountable";

export interface PermissionRequest {
  product?: string;
  tool?: string;
  action?: string;
  data?: string;
  /** Estimated spend of the request, in millionths of a currency unit. */
  costMicros?: number;
  /** Spend already recorded in the agent's current budget period. */
  spentMicros?: number;
  at?: Date;
}

export function withinSchedule(schedule: AgentSchedule, at: Date): boolean {
  if (schedule.days && !schedule.days.includes(at.getUTCDay())) return false;
  const { fromHour, toHour } = schedule;
  if (fromHour === undefined || toHour === undefined) return true;
  const hour = at.getUTCHours();
  return fromHour <= toHour
    ? hour >= fromHour && hour < toHour
    : hour >= fromHour || hour < toHour;
}

/** Every reason the request is refused. An empty list means it is allowed. */
export function permissionRefusals(
  agents: readonly Agent[],
  id: string,
  request: PermissionRequest,
): PermissionRefusal[] {
  const agent = agents.find((candidate) => candidate.id === id);
  if (!agent) return ["unaccountable"];
  const refusals: PermissionRefusal[] = [];
  if (agent.status === "retired") refusals.push("retired");
  if (agent.status === "paused") refusals.push("paused");
  if (accountableFor(agents, id) === null) refusals.push("unaccountable");
  if (request.at && !withinSchedule(agent.schedule, request.at))
    refusals.push("outside_schedule");
  for (const kind of ["product", "tool", "action", "data"] as const) {
    const value = request[kind];
    if (value !== undefined && !inScope(agent, `${kind}s` as ScopeKind, value))
      refusals.push(`${kind}_out_of_scope`);
  }
  if (
    agent.budgetMicros !== null &&
    (request.spentMicros ?? 0) + (request.costMicros ?? 0) > agent.budgetMicros
  )
    refusals.push("over_budget");
  return refusals;
}

/** The start of the budget period containing `at`, in UTC. */
export function periodStart(period: BudgetPeriod, at: Date): Date {
  if (period === "total") return new Date(0);
  const start = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  if (period === "week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(1);
  return start;
}

export interface OrgOverview {
  total: number;
  active: number;
  blocked: number;
  needsAttention: number;
  paused: number;
  /** Agents with nobody answerable for them. Should always be empty. */
  unaccountable: string[];
}

export function orgOverview(agents: readonly Agent[]): OrgOverview {
  const live = agents.filter((agent) => agent.status !== "retired");
  const count = (status: AgentStatus) =>
    live.filter((agent) => agent.status === status).length;
  return {
    total: live.length,
    active: count("active"),
    blocked: count("blocked"),
    needsAttention: count("needs_attention"),
    paused: count("paused"),
    unaccountable: live
      .filter((agent) => accountableFor(agents, agent.id) === null)
      .map((agent) => agent.id),
  };
}
