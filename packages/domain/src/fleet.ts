/**
 * Fleet plan: a large objective broken into subtasks with dependencies, so
 * a supervisor can start independent work in parallel, hold back what is
 * waiting on something else, and merge results in a safe order.
 */

export type FleetTaskState =
  "pending" | "running" | "blocked" | "failed" | "done" | "merged";

export interface FleetTask {
  id: string;
  title: string;
  /** The scoped instructions one worker receives. */
  brief: string;
  /** The interface this task must honour so other tasks can rely on it. */
  contract: string;
  dependsOn: readonly string[];
  state: FleetTaskState;
  worker: string | null;
  branch: string | null;
  attempts: number;
  note: string;
}

export type PlanTask = Pick<FleetTask, "id" | "title" | "brief"> &
  Partial<Pick<FleetTask, "contract" | "dependsOn">>;

/** Every problem with a proposed plan. Empty means it can be run. */
export function planProblems(tasks: readonly PlanTask[]): string[] {
  const problems: string[] = [];
  if (tasks.length === 0) problems.push("A plan needs at least one subtask");
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(task.id))
      problems.push(
        `Subtask id "${task.id}" must be short, lower-case letters, digits and hyphens`,
      );
    if (ids.has(task.id))
      problems.push(`Subtask id "${task.id}" is used twice`);
    ids.add(task.id);
    if (!task.title.trim() || !task.brief.trim())
      problems.push(`Subtask "${task.id}" needs a title and a brief`);
  }
  for (const task of tasks)
    for (const dependency of task.dependsOn ?? []) {
      if (dependency === task.id)
        problems.push(`Subtask "${task.id}" depends on itself`);
      else if (!ids.has(dependency))
        problems.push(
          `Subtask "${task.id}" depends on unknown "${dependency}"`,
        );
    }
  if (problems.length === 0 && waves(tasks) === null)
    problems.push("The subtasks depend on each other in a loop");
  return problems;
}

/**
 * Groups subtasks into waves: everything in a wave can run in parallel once
 * the waves before it are finished. Returns null when there is a loop.
 */
export function waves(tasks: readonly PlanTask[]): string[][] | null {
  const remaining = new Map(
    tasks.map((t) => [t.id, new Set(t.dependsOn ?? [])]),
  );
  const result: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(([, needs]) => [...needs].every((id) => !remaining.has(id)))
      .map(([id]) => id);
    if (ready.length === 0) return null;
    result.push(ready);
    for (const id of ready) remaining.delete(id);
  }
  return result;
}

const finished: readonly FleetTaskState[] = ["done", "merged"];

/** Pending subtasks whose dependencies are all finished. */
export function readyTasks(tasks: readonly FleetTask[]): FleetTask[] {
  const state = new Map(tasks.map((task) => [task.id, task.state]));
  return tasks.filter(
    (task) =>
      task.state === "pending" &&
      task.dependsOn.every((id) => finished.includes(state.get(id)!)),
  );
}

/** Subtasks that cannot start because something they need failed or is blocked. */
export function stalledBy(tasks: readonly FleetTask[]): Map<string, string[]> {
  const state = new Map(tasks.map((task) => [task.id, task.state]));
  const result = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.state !== "pending") continue;
    const causes = task.dependsOn.filter((id) =>
      ["failed", "blocked"].includes(state.get(id)!),
    );
    if (causes.length) result.set(task.id, causes);
  }
  return result;
}

/** Finished branches in the order they can be merged: dependencies first. */
export function mergeOrder(tasks: readonly FleetTask[]): FleetTask[] {
  const order = (waves(tasks) ?? []).flat();
  return order
    .map((id) => tasks.find((task) => task.id === id)!)
    .filter((task) => task.state === "done" && task.branch !== null);
}

export interface FleetOverview {
  total: number;
  counts: Record<FleetTaskState, number>;
  /** Share of subtasks finished, from 0 to 1. */
  progress: number;
  readyToStart: string[];
  needsAttention: string[];
  /** True when every subtask is merged and integration tests can run. */
  readyToIntegrate: boolean;
}

export function fleetOverview(tasks: readonly FleetTask[]): FleetOverview {
  const counts: Record<FleetTaskState, number> = {
    pending: 0,
    running: 0,
    blocked: 0,
    failed: 0,
    done: 0,
    merged: 0,
  };
  for (const task of tasks) counts[task.state] += 1;
  return {
    total: tasks.length,
    counts,
    progress: tasks.length ? (counts.done + counts.merged) / tasks.length : 0,
    readyToStart: readyTasks(tasks).map((task) => task.id),
    needsAttention: tasks
      .filter((task) => task.state === "failed" || task.state === "blocked")
      .map((task) => task.id),
    readyToIntegrate: tasks.length > 0 && counts.merged === tasks.length,
  };
}

/** The brief a worker receives: its own scope plus the contracts it relies on. */
export function workerBrief(
  objective: string,
  task: FleetTask,
  tasks: readonly FleetTask[],
): string {
  const needs = tasks.filter((other) => task.dependsOn.includes(other.id));
  return [
    "You are one worker on a larger objective: " + objective,
    "",
    "Your subtask: " + task.title,
    task.brief,
    ...(task.contract
      ? ["", "Interface you must provide:", task.contract]
      : []),
    ...(needs.length
      ? [
          "",
          "Already delivered, which you can rely on:",
          ...needs.map(
            (n) => `- ${n.title}${n.contract ? ": " + n.contract : ""}`,
          ),
        ]
      : []),
    "",
    "Work only in your own worktree and branch. Do not change other subtasks' interfaces; report a mismatch to the supervisor instead.",
  ].join("\n");
}
