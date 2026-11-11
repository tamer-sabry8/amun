import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  agentStatuses,
  budgetPeriods,
  orgOverview,
  orgTree,
  periodStart,
  permissionRefusals,
  wouldLoop,
  type Agent,
  type AgentSchedule,
  type AgentScopes,
  type AgentStatus,
  type BudgetPeriod,
  type PermissionRefusal,
  type PermissionRequest,
} from "../../domain/src/agent-org.ts";

export const assignmentKinds = [
  "product",
  "project",
  "team",
  "customer",
  "workflow",
] as const;
export type AssignmentKind = (typeof assignmentKinds)[number];

export interface AgentInput {
  displayName: string;
  role: string;
  title: string;
  description?: string;
  runtime: string;
  externalRef?: string;
  accountableOwner?: string;
  managerId?: string;
  status?: AgentStatus;
  scopes?: AgentScopes;
  budget?: { micros: number; period: BudgetPeriod };
  schedule?: AgentSchedule;
  escalation?: string;
}

interface AgentRow {
  id: string;
  display_name: string;
  role: string;
  title: string;
  description: string;
  runtime: string;
  external_ref: string | null;
  accountable_owner: string | null;
  manager_id: string | null;
  status: AgentStatus;
  scopes_json: string;
  budget_micros: number | null;
  budget_period: BudgetPeriod | null;
  schedule_json: string;
  escalation: string | null;
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    title: row.title,
    description: row.description,
    runtime: row.runtime,
    externalRef: row.external_ref,
    accountableOwner: row.accountable_owner,
    managerId: row.manager_id,
    status: row.status,
    scopes: JSON.parse(row.scopes_json) as AgentScopes,
    budgetMicros: row.budget_micros,
    budgetPeriod: row.budget_period,
    schedule: JSON.parse(row.schedule_json) as AgentSchedule,
    escalation: row.escalation,
  };
}

function text(value: string, name: string, max = 256): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw Error("Invalid agent " + name);
  return trimmed;
}

/** The registry of agents, first-party and customer-supplied alike. */
export class AgentOrg {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  agents(): Agent[] {
    return (
      this.db
        .prepare("SELECT * FROM agents ORDER BY display_name,id")
        .all() as AgentRow[]
    ).map(toAgent);
  }

  agent(id: string): Agent {
    const row = this.db.prepare("SELECT * FROM agents WHERE id=?").get(id) as
      AgentRow | undefined;
    if (!row) throw Error("Unknown agent");
    return toAgent(row);
  }

  /**
   * Registers an agent from any runtime. It needs either an accountable
   * owner of its own or a manager whose line leads to one.
   */
  register(input: AgentInput): Agent {
    const id = randomUUID();
    return this.write(id, input, true);
  }

  /** Changes an agent in place. Its identity and history are kept. */
  update(id: string, changes: Partial<AgentInput>): Agent {
    const current = this.agent(id);
    return this.write(
      id,
      {
        displayName: current.displayName,
        role: current.role,
        title: current.title,
        description: current.description,
        runtime: current.runtime,
        scopes: current.scopes,
        schedule: current.schedule,
        status: current.status,
        ...(current.externalRef ? { externalRef: current.externalRef } : {}),
        ...(current.accountableOwner
          ? { accountableOwner: current.accountableOwner }
          : {}),
        ...(current.managerId ? { managerId: current.managerId } : {}),
        ...(current.escalation ? { escalation: current.escalation } : {}),
        ...(current.budgetMicros !== null && current.budgetPeriod !== null
          ? {
              budget: {
                micros: current.budgetMicros,
                period: current.budgetPeriod,
              },
            }
          : {}),
        ...changes,
      },
      false,
    );
  }

  /** Moves an agent under another manager, or to the top with an owner. */
  reassign(id: string, managerId: string | null, owner?: string): Agent {
    const current = this.agent(id);
    const accountableOwner = owner ?? current.accountableOwner ?? undefined;
    if (managerId === null && !accountableOwner)
      throw Error("An agent without a manager needs an accountable owner");
    this.db
      .prepare(
        "UPDATE agents SET manager_id=?, accountable_owner=?, updated_at=? WHERE id=?",
      )
      .run(
        this.checkedManager(id, managerId),
        accountableOwner ?? null,
        new Date().toISOString(),
        id,
      );
    return this.agent(id);
  }

  setStatus(id: string, status: AgentStatus): Agent {
    if (!agentStatuses.includes(status)) throw Error("Invalid agent status");
    this.agent(id);
    this.db
      .prepare("UPDATE agents SET status=?, updated_at=? WHERE id=?")
      .run(status, new Date().toISOString(), id);
    return this.agent(id);
  }

  /** Records two agents as cross-functional collaborators. */
  collaborate(first: string, second: string): void {
    if (first === second)
      throw Error("An agent cannot collaborate with itself");
    this.agent(first);
    this.agent(second);
    const [low, high] = [first, second].sort() as [string, string];
    this.db
      .prepare(
        "INSERT OR IGNORE INTO agent_collaborators(agent_id,peer_id) VALUES (?,?)",
      )
      .run(low, high);
  }

  collaborators(id: string): Agent[] {
    const rows = this.db
      .prepare(
        `SELECT a.* FROM agents a JOIN agent_collaborators c
           ON (c.agent_id=? AND c.peer_id=a.id) OR (c.peer_id=? AND c.agent_id=a.id)
         ORDER BY a.display_name,a.id`,
      )
      .all(id, id) as AgentRow[];
    return rows.map(toAgent);
  }

  assign(id: string, kind: AssignmentKind, targetId: string): void {
    if (!assignmentKinds.includes(kind)) throw Error("Invalid assignment");
    this.agent(id);
    this.db
      .prepare(
        "INSERT OR IGNORE INTO agent_assignments(agent_id,target_kind,target_id,assigned_at) VALUES (?,?,?,?)",
      )
      .run(id, kind, text(targetId, "assignment"), new Date().toISOString());
  }

  unassign(id: string, kind: AssignmentKind, targetId: string): void {
    this.db
      .prepare(
        "DELETE FROM agent_assignments WHERE agent_id=? AND target_kind=? AND target_id=?",
      )
      .run(id, kind, targetId);
  }

  assignments(id: string): { kind: AssignmentKind; targetId: string }[] {
    return this.db
      .prepare(
        "SELECT target_kind AS kind, target_id AS targetId FROM agent_assignments WHERE agent_id=? ORDER BY target_kind,target_id",
      )
      .all(id) as { kind: AssignmentKind; targetId: string }[];
  }

  /** Agents assigned to one project, team, customer, workflow or product. */
  assignedTo(kind: AssignmentKind, targetId: string): Agent[] {
    const rows = this.db
      .prepare(
        `SELECT a.* FROM agents a JOIN agent_assignments s ON s.agent_id=a.id
         WHERE s.target_kind=? AND s.target_id=? ORDER BY a.display_name,a.id`,
      )
      .all(kind, targetId) as AgentRow[];
    return rows.map(toAgent);
  }

  /** Adds reported spend to an agent's history. */
  recordUsage(id: string, micros: number, ref?: string, at = new Date()): void {
    if (!Number.isSafeInteger(micros) || micros < 0)
      throw Error("Invalid agent usage");
    this.agent(id);
    this.db
      .prepare(
        "INSERT INTO agent_usage(id,agent_id,at,micros,ref) VALUES (?,?,?,?,?)",
      )
      .run(randomUUID(), id, at.toISOString(), micros, ref ?? null);
  }

  /** Spend recorded in the agent's current budget period. */
  spent(id: string, at = new Date()): number {
    const agent = this.agent(id);
    const since = periodStart(agent.budgetPeriod ?? "total", at).toISOString();
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(micros),0) AS total FROM agent_usage WHERE agent_id=? AND at>=? AND at<=?",
      )
      .get(id, since, at.toISOString()) as { total: number };
    return row.total;
  }

  /** Reasons the agent may not do this now. Empty means it may. */
  refusals(
    id: string,
    request: Omit<PermissionRequest, "spentMicros">,
  ): PermissionRefusal[] {
    const at = request.at ?? new Date();
    return permissionRefusals(this.agents(), id, {
      ...request,
      at,
      spentMicros: this.spent(id, at),
    });
  }

  tree() {
    return orgTree(this.agents());
  }

  overview() {
    return orgOverview(this.agents());
  }

  private checkedManager(id: string, managerId: string | null): string | null {
    if (managerId === null) return null;
    this.agent(managerId);
    if (wouldLoop(this.agents(), id, managerId))
      throw Error("An agent cannot report to itself or to its own reports");
    return managerId;
  }

  private write(id: string, input: AgentInput, create: boolean): Agent {
    const status = input.status ?? "active";
    if (!agentStatuses.includes(status)) throw Error("Invalid agent status");
    if (
      input.budget &&
      (!budgetPeriods.includes(input.budget.period) ||
        !Number.isSafeInteger(input.budget.micros) ||
        input.budget.micros < 0)
    )
      throw Error("Invalid agent budget");
    const managerId = this.checkedManager(id, input.managerId ?? null);
    const owner = input.accountableOwner?.trim() || null;
    if (!owner && !managerId)
      throw Error("An agent needs an accountable owner or a manager");
    const now = new Date().toISOString();
    const row = {
      id,
      display_name: text(input.displayName, "name"),
      role: text(input.role, "role"),
      title: text(input.title, "title"),
      description: (input.description ?? "").slice(0, 4096),
      runtime: text(input.runtime, "runtime", 64),
      external_ref: input.externalRef?.trim() || null,
      accountable_owner: owner,
      manager_id: managerId,
      status,
      scopes_json: JSON.stringify(input.scopes ?? {}),
      budget_micros: input.budget?.micros ?? null,
      budget_period: input.budget?.period ?? null,
      schedule_json: JSON.stringify(input.schedule ?? {}),
      escalation: input.escalation?.trim() || null,
      now,
    };
    this.db
      .prepare(
        create
          ? `INSERT INTO agents(id,display_name,role,title,description,runtime,external_ref,accountable_owner,manager_id,status,scopes_json,budget_micros,budget_period,schedule_json,escalation,created_at,updated_at)
             VALUES (@id,@display_name,@role,@title,@description,@runtime,@external_ref,@accountable_owner,@manager_id,@status,@scopes_json,@budget_micros,@budget_period,@schedule_json,@escalation,@now,@now)`
          : `UPDATE agents SET display_name=@display_name,role=@role,title=@title,description=@description,runtime=@runtime,external_ref=@external_ref,accountable_owner=@accountable_owner,manager_id=@manager_id,status=@status,scopes_json=@scopes_json,budget_micros=@budget_micros,budget_period=@budget_period,schedule_json=@schedule_json,escalation=@escalation,updated_at=@now WHERE id=@id`,
      )
      .run(row);
    return this.agent(id);
  }
}
