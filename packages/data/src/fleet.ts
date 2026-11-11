import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  fleetOverview,
  mergeOrder,
  planProblems,
  readyTasks,
  stalledBy,
  workerBrief,
  type FleetTask,
  type FleetTaskState,
  type PlanTask,
} from "../../domain/src/fleet.ts";

export type FleetState =
  "planned" | "running" | "integrating" | "delivered" | "cancelled";

export interface FleetPlan {
  id: string;
  objective: string;
  objectiveRef: string | null;
  supervisor: string;
  integrationBranch: string;
  state: FleetState;
  tasks: FleetTask[];
}

interface TaskRow {
  task_id: string;
  title: string;
  brief: string;
  contract: string;
  depends_json: string;
  state: FleetTaskState;
  worker: string | null;
  branch: string | null;
  attempts: number;
  note: string;
}

export const maxAttempts = 3;

/**
 * A supervisor's plan and the state of its workers. Spawning workers stays
 * with Firstmate; this records the plan, decides what may start, and keeps
 * the order in which finished branches are merged.
 */
export class Fleet {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  plan(input: {
    objective: string;
    supervisor: string;
    tasks: readonly PlanTask[];
    objectiveRef?: string;
  }): FleetPlan {
    const problems = planProblems(input.tasks);
    if (!input.objective.trim()) problems.push("State the objective");
    if (!input.supervisor.trim()) problems.push("Name the supervisor");
    if (problems.length) throw Error(problems.join("; "));
    const id = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO fleet_plans(id,objective,objective_ref,supervisor,integration_branch,state,created_at) VALUES (?,?,?,?,?,'planned',?)",
        )
        .run(
          id,
          input.objective.trim(),
          input.objectiveRef ?? null,
          input.supervisor,
          "fleet/" + id.slice(0, 8) + "/integration",
          new Date().toISOString(),
        );
      input.tasks.forEach((task, position) =>
        this.db
          .prepare(
            "INSERT INTO fleet_tasks(plan_id,task_id,position,title,brief,contract,depends_json,state) VALUES (?,?,?,?,?,?,?,'pending')",
          )
          .run(
            id,
            task.id,
            position,
            task.title.trim(),
            task.brief.trim(),
            task.contract ?? "",
            JSON.stringify(task.dependsOn ?? []),
          ),
      );
    })();
    return this.get(id);
  }

  get(id: string): FleetPlan {
    const row = this.db
      .prepare("SELECT * FROM fleet_plans WHERE id=?")
      .get(id) as
      | {
          id: string;
          objective: string;
          objective_ref: string | null;
          supervisor: string;
          integration_branch: string;
          state: FleetState;
        }
      | undefined;
    if (!row) throw Error("Unknown fleet plan");
    const tasks = (
      this.db
        .prepare("SELECT * FROM fleet_tasks WHERE plan_id=? ORDER BY position")
        .all(id) as TaskRow[]
    ).map((task): FleetTask => ({
      id: task.task_id,
      title: task.title,
      brief: task.brief,
      contract: task.contract,
      dependsOn: JSON.parse(task.depends_json) as string[],
      state: task.state,
      worker: task.worker,
      branch: task.branch,
      attempts: task.attempts,
      note: task.note,
    }));
    return {
      id: row.id,
      objective: row.objective,
      objectiveRef: row.objective_ref,
      supervisor: row.supervisor,
      integrationBranch: row.integration_branch,
      state: row.state,
      tasks,
    };
  }

  overview(id: string) {
    const plan = this.get(id);
    return {
      ...fleetOverview(plan.tasks),
      state: plan.state,
      stalled: Object.fromEntries(stalledBy(plan.tasks)),
    };
  }

  /**
   * Starts a subtask whose dependencies are finished. Returns the worker's
   * brief and the branch it must use.
   */
  start(
    id: string,
    taskId: string,
    worker: string,
  ): { brief: string; branch: string } {
    return this.db
      .transaction(() => {
        const plan = this.get(id);
        if (plan.state === "cancelled" || plan.state === "delivered")
          throw Error("This plan is closed");
        const task = readyTasks(plan.tasks).find((t) => t.id === taskId);
        if (!task) throw Error("That subtask is not ready to start");
        if (!worker.trim()) throw Error("Name the worker");
        const branch = `fleet/${id.slice(0, 8)}/${taskId}`;
        this.db
          .prepare(
            "UPDATE fleet_tasks SET state='running',worker=?,branch=?,attempts=attempts+1,note='' WHERE plan_id=? AND task_id=?",
          )
          .run(worker, branch, id, taskId);
        this.db
          .prepare("UPDATE fleet_plans SET state='running' WHERE id=?")
          .run(id);
        return { brief: workerBrief(plan.objective, task, plan.tasks), branch };
      })
      .immediate();
  }

  /** A worker reports its result. A question or failure needs a note. */
  report(
    id: string,
    taskId: string,
    outcome: "done" | "blocked" | "failed",
    note = "",
  ): FleetTask {
    const task = this.task(id, taskId);
    if (task.state !== "running") throw Error("That subtask is not running");
    if (outcome !== "done" && !note.trim())
      throw Error("Say what blocked or failed the subtask");
    this.db
      .prepare(
        "UPDATE fleet_tasks SET state=?,note=? WHERE plan_id=? AND task_id=?",
      )
      .run(outcome, note.trim().slice(0, 2000), id, taskId);
    return this.task(id, taskId);
  }

  /** The supervisor answers a question or retries a failure. */
  retry(id: string, taskId: string, answer = ""): FleetTask {
    const task = this.task(id, taskId);
    if (task.state !== "failed" && task.state !== "blocked")
      throw Error("Only a failed or blocked subtask can be retried");
    if (task.attempts >= maxAttempts)
      throw Error(
        `This subtask already ran ${maxAttempts} times; it needs a person`,
      );
    this.db
      .prepare(
        "UPDATE fleet_tasks SET state='pending',note=? WHERE plan_id=? AND task_id=?",
      )
      .run(answer.trim().slice(0, 2000), id, taskId);
    return this.task(id, taskId);
  }

  /** Finished branches not yet merged, dependencies first. */
  mergeQueue(id: string): FleetTask[] {
    return mergeOrder(this.get(id).tasks);
  }

  /** Records that the next branch in the queue reached the integration branch. */
  merged(id: string, taskId: string): FleetPlan {
    return this.db
      .transaction(() => {
        const next = this.mergeQueue(id)[0];
        if (!next || next.id !== taskId)
          throw Error("Merge branches in order; another subtask comes first");
        this.db
          .prepare(
            "UPDATE fleet_tasks SET state='merged' WHERE plan_id=? AND task_id=?",
          )
          .run(id, taskId);
        if (fleetOverview(this.get(id).tasks).readyToIntegrate)
          this.db
            .prepare("UPDATE fleet_plans SET state='integrating' WHERE id=?")
            .run(id);
        return this.get(id);
      })
      .immediate();
  }

  /** Marks the plan delivered once integration tests passed. */
  deliver(id: string, integrationTestsPassed: boolean): FleetPlan {
    const plan = this.get(id);
    if (plan.state !== "integrating")
      throw Error("Every subtask must be merged before delivery");
    if (!integrationTestsPassed)
      throw Error(
        "Integration tests must pass before one pull request is opened",
      );
    this.db
      .prepare("UPDATE fleet_plans SET state='delivered' WHERE id=?")
      .run(id);
    return this.get(id);
  }

  cancel(id: string): FleetPlan {
    this.get(id);
    this.db
      .prepare("UPDATE fleet_plans SET state='cancelled' WHERE id=?")
      .run(id);
    return this.get(id);
  }

  private task(id: string, taskId: string): FleetTask {
    const task = this.get(id).tasks.find((t) => t.id === taskId);
    if (!task) throw Error("Unknown subtask");
    return task;
  }
}
