import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export const goalLevels = [
  "goal",
  "initiative",
  "project",
  "workstream",
] as const;
export type GoalLevel = (typeof goalLevels)[number];

export const goalStatuses = [
  "active",
  "achieved",
  "paused",
  "dropped",
] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export const linkKinds = [
  "objective",
  "work_item",
  "run",
  "session",
  "artifact",
  "decision",
] as const;
export type LinkKind = (typeof linkKinds)[number];

/**
 * Whether linked work moved the goal. This is separate from the work being
 * finished: a completed task can still have had no effect.
 */
export const contributions = [
  "unassessed",
  "advanced",
  "no_effect",
  "set_back",
] as const;
export type Contribution = (typeof contributions)[number];

export const defaultCategories = [
  "revenue growth",
  "customer retention",
  "operational efficiency",
  "product quality",
  "compliance",
  "customer satisfaction",
] as const;

export interface Goal {
  id: string;
  parentId: string | null;
  level: GoalLevel;
  category: string;
  title: string;
  why: string;
  beneficiaries: string;
  success: string;
  constraints: string;
  rules: string;
  priority: number;
  status: GoalStatus;
}

export interface GoalLink {
  goalId: string;
  kind: LinkKind;
  targetId: string;
  contribution: Contribution;
  note: string;
  agentId: string | null;
}

export interface AlignmentPolicy {
  /** Categories administrators allow. Goals must use one of them. */
  categories: string[];
  /** Kinds of work that must be linked to a goal before they start. */
  required: LinkKind[];
}

export interface GoalReport {
  goal: Goal;
  /** Links on this goal and everything beneath it. */
  linked: number;
  advanced: number;
  noEffect: number;
  setBack: number;
  unassessed: number;
  /** Share of assessed work that advanced the goal, or null if none assessed. */
  advancedShare: number | null;
  /** Spend recorded for the agents credited on the linked work. */
  costMicros: number;
  byAgent: { agentId: string; linked: number; advanced: number }[];
}

interface GoalRow {
  id: string;
  parent_id: string | null;
  level: GoalLevel;
  category: string;
  title: string;
  why: string;
  beneficiaries: string;
  success: string;
  constraints_text: string;
  rules_text: string;
  priority: number;
  status: GoalStatus;
}

interface LinkRow {
  goal_id: string;
  target_kind: LinkKind;
  target_id: string;
  contribution: Contribution;
  note: string;
  agent_id: string | null;
}

const policyKey = "goal_alignment";

function toGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    parentId: row.parent_id,
    level: row.level,
    category: row.category,
    title: row.title,
    why: row.why,
    beneficiaries: row.beneficiaries,
    success: row.success,
    constraints: row.constraints_text,
    rules: row.rules_text,
    priority: row.priority,
    status: row.status,
  };
}

function toLink(row: LinkRow): GoalLink {
  return {
    goalId: row.goal_id,
    kind: row.target_kind,
    targetId: row.target_id,
    contribution: row.contribution,
    note: row.note,
    agentId: row.agent_id,
  };
}

/**
 * Organisational goals above a product's objectives. Existing objectives,
 * work items, runs, sessions, artifacts and decisions link to a goal; they
 * are not copied.
 */
export class Goals {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  policy(): AlignmentPolicy {
    const row = this.db
      .prepare("SELECT value_json FROM workspace_settings WHERE id=?")
      .get(policyKey) as { value_json: string } | undefined;
    const stored = row
      ? (JSON.parse(row.value_json) as Partial<AlignmentPolicy>)
      : {};
    return {
      categories: stored.categories ?? [...defaultCategories],
      required: stored.required ?? [],
    };
  }

  /** Sets the goal categories and which kinds of work must be aligned. */
  setPolicy(policy: AlignmentPolicy): AlignmentPolicy {
    const categories = [
      ...new Set(policy.categories.map((c) => c.trim().toLowerCase())),
    ].filter(Boolean);
    if (categories.length === 0 || categories.some((c) => c.length > 64))
      throw Error("A goal taxonomy needs at least one short category");
    if (policy.required.some((kind) => !linkKinds.includes(kind)))
      throw Error("Unknown kind of work in the alignment rule");
    const next = { categories, required: [...new Set(policy.required)] };
    this.db
      .prepare(
        `INSERT INTO workspace_settings(id,value_json) VALUES (?,?)
         ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json`,
      )
      .run(policyKey, JSON.stringify(next));
    return next;
  }

  goal(id: string): Goal {
    const row = this.db.prepare("SELECT * FROM goals WHERE id=?").get(id) as
      GoalRow | undefined;
    if (!row) throw Error("Unknown goal");
    return toGoal(row);
  }

  goals(): Goal[] {
    return (
      this.db
        .prepare("SELECT * FROM goals ORDER BY priority,title,id")
        .all() as GoalRow[]
    ).map(toGoal);
  }

  /** Adds a goal, or an initiative, project or workstream beneath one. */
  create(input: {
    title: string;
    level?: GoalLevel;
    parentId?: string;
    category?: string;
    why?: string;
    beneficiaries?: string;
    success?: string;
    constraints?: string;
    rules?: string;
    priority?: number;
  }): Goal {
    const level = input.level ?? (input.parentId ? "initiative" : "goal");
    if (!goalLevels.includes(level)) throw Error("Unknown goal level");
    const parent = input.parentId ? this.goal(input.parentId) : null;
    if (level === "goal" && parent) throw Error("A goal sits at the top");
    if (level !== "goal" && !parent)
      throw Error("Initiatives, projects and workstreams belong to a goal");
    if (parent && goalLevels.indexOf(level) <= goalLevels.indexOf(parent.level))
      throw Error("Work must sit below the level it belongs to");
    const category = (input.category ?? parent?.category ?? "")
      .trim()
      .toLowerCase();
    if (!this.policy().categories.includes(category))
      throw Error("Choose a category from the goal taxonomy");
    const title = input.title.trim();
    if (!title || title.length > 256) throw Error("A goal needs a short title");
    const priority = input.priority ?? 3;
    if (!Number.isInteger(priority) || priority < 1 || priority > 5)
      throw Error("Priority runs from 1 (highest) to 5");
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO goals(id,parent_id,level,category,title,why,beneficiaries,success,constraints_text,rules_text,priority,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?)`,
      )
      .run(
        id,
        parent?.id ?? null,
        level,
        category,
        title,
        input.why ?? "",
        input.beneficiaries ?? "",
        input.success ?? "",
        input.constraints ?? "",
        input.rules ?? "",
        priority,
        new Date().toISOString(),
      );
    return this.goal(id);
  }

  setStatus(id: string, status: GoalStatus): Goal {
    if (!goalStatuses.includes(status)) throw Error("Unknown goal status");
    this.goal(id);
    this.db.prepare("UPDATE goals SET status=? WHERE id=?").run(status, id);
    return this.goal(id);
  }

  /** The goal's ancestors, top-level goal first, ending with the goal itself. */
  lineage(id: string): Goal[] {
    const path: Goal[] = [];
    let current: Goal | null = this.goal(id);
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.goal(current.parentId) : null;
    }
    return path;
  }

  /** The goal and everything beneath it, parents before children. */
  subtree(id: string): Goal[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE tree(id,depth) AS (
           SELECT ?,0 UNION ALL
           SELECT g.id,t.depth+1 FROM goals g JOIN tree t ON g.parent_id=t.id
         )
         SELECT g.* FROM goals g JOIN tree t ON t.id=g.id ORDER BY t.depth,g.priority,g.title,g.id`,
      )
      .all(id) as GoalRow[];
    if (rows.length === 0) throw Error("Unknown goal");
    return rows.map(toGoal);
  }

  /** Connects a piece of work to a goal. Linking twice changes nothing. */
  link(
    goalId: string,
    kind: LinkKind,
    targetId: string,
    agentId?: string,
  ): GoalLink {
    if (!linkKinds.includes(kind)) throw Error("Unknown kind of work");
    if (!targetId.trim()) throw Error("Name the work to link");
    if (this.goal(goalId).status === "dropped")
      throw Error("A dropped goal takes no new work");
    this.db
      .prepare(
        `INSERT OR IGNORE INTO goal_links(goal_id,target_kind,target_id,agent_id,linked_at) VALUES (?,?,?,?,?)`,
      )
      .run(goalId, kind, targetId, agentId ?? null, new Date().toISOString());
    return this.links(goalId).find(
      (link) => link.kind === kind && link.targetId === targetId,
    )!;
  }

  /** Records whether linked work moved the goal, with the reason. */
  assess(
    goalId: string,
    kind: LinkKind,
    targetId: string,
    contribution: Contribution,
    note: string,
  ): void {
    if (!contributions.includes(contribution))
      throw Error("Unknown contribution");
    if (contribution !== "unassessed" && !note.trim())
      throw Error("Say why the work did or did not advance the goal");
    const result = this.db
      .prepare(
        `UPDATE goal_links SET contribution=?, note=?, assessed_at=? WHERE goal_id=? AND target_kind=? AND target_id=?`,
      )
      .run(
        contribution,
        note.trim(),
        new Date().toISOString(),
        goalId,
        kind,
        targetId,
      );
    if (result.changes === 0)
      throw Error("That work is not linked to the goal");
  }

  /** Work linked directly to one goal. */
  links(goalId: string): GoalLink[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM goal_links WHERE goal_id=? ORDER BY linked_at,rowid",
        )
        .all(goalId) as LinkRow[]
    ).map(toLink);
  }

  /** Downward trace: all work linked to a goal or anything beneath it. */
  contributors(goalId: string): GoalLink[] {
    return this.subtree(goalId).flatMap((goal) => this.links(goal.id));
  }

  /** Upward trace: each goal a piece of work serves, with its full lineage. */
  goalsFor(kind: LinkKind, targetId: string): Goal[][] {
    const rows = this.db
      .prepare(
        "SELECT goal_id FROM goal_links WHERE target_kind=? AND target_id=? ORDER BY linked_at,rowid",
      )
      .all(kind, targetId) as { goal_id: string }[];
    return rows.map((row) => this.lineage(row.goal_id));
  }

  /** True when the policy lets this work start: aligned, or not required. */
  aligned(kind: LinkKind, targetId: string): boolean {
    return (
      !this.policy().required.includes(kind) ||
      this.goalsFor(kind, targetId).length > 0
    );
  }

  /**
   * The goal context an agent receives with a task: why the work matters,
   * who benefits, what success looks like, and the limits it works within.
   */
  context(kind: LinkKind, targetId: string): string {
    const paths = this.goalsFor(kind, targetId);
    if (paths.length === 0) return "";
    return paths
      .map((path) => {
        const goal = path.at(-1)!;
        const top = path[0]!;
        const inherit = (pick: (g: Goal) => string) =>
          [...path].reverse().map(pick).find(Boolean) ?? "";
        return [
          "Goal: " + path.map((g) => g.title).join(" › "),
          "Category: " + top.category + " · Priority " + goal.priority,
          ["Why it matters", inherit((g) => g.why)],
          ["Who benefits", inherit((g) => g.beneficiaries)],
          ["Success looks like", inherit((g) => g.success)],
          ["Constraints", inherit((g) => g.constraints)],
          ["Business rules", inherit((g) => g.rules)],
        ]
          .map((line) =>
            typeof line === "string"
              ? line
              : line[1]
                ? line[0] + ": " + line[1]
                : "",
          )
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  }

  /** Progress, contribution by agent and cost for a goal and its subtree. */
  report(goalId: string): GoalReport {
    const links = this.contributors(goalId);
    const count = (c: Contribution) =>
      links.filter((link) => link.contribution === c).length;
    const advanced = count("advanced");
    const assessed = links.length - count("unassessed");
    const agents = [
      ...new Set(links.map((l) => l.agentId).filter((id) => id !== null)),
    ].sort();
    const refs = links.map((link) => link.targetId);
    const cost =
      refs.length === 0
        ? 0
        : (
            this.db
              .prepare(
                `SELECT COALESCE(SUM(micros),0) AS total FROM agent_usage WHERE ref IN (${refs.map(() => "?").join(",")})`,
              )
              .get(...refs) as { total: number }
          ).total;
    return {
      goal: this.goal(goalId),
      linked: links.length,
      advanced,
      noEffect: count("no_effect"),
      setBack: count("set_back"),
      unassessed: count("unassessed"),
      advancedShare: assessed === 0 ? null : advanced / assessed,
      costMicros: cost,
      byAgent: agents.map((agentId) => ({
        agentId,
        linked: links.filter((l) => l.agentId === agentId).length,
        advanced: links.filter(
          (l) => l.agentId === agentId && l.contribution === "advanced",
        ).length,
      })),
    };
  }
}
