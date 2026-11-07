import { createHash } from "node:crypto";

export const actionKinds = [
  "publish",
  "commit",
  "merge",
  "notion_publish",
  "github_issue",
  "file_destructive",
  "skill_install",
  "model_outside_allowlist",
] as const;
export type ActionKind = (typeof actionKinds)[number];
export const actionStates = [
  "proposed",
  "pending_approval",
  "approved",
  "rejected",
  "expired",
  "invalidated",
  "executing",
  "succeeded",
  "failed",
  "unknown",
  "needs_review",
] as const;
export type ActionState = (typeof actionStates)[number];
const edges: Record<ActionState, readonly ActionState[]> = {
  proposed: ["pending_approval"],
  pending_approval: ["approved", "rejected", "expired"],
  approved: ["invalidated", "executing"],
  executing: ["succeeded", "failed", "unknown"],
  unknown: ["succeeded", "failed", "needs_review"],
  invalidated: ["pending_approval"],
  rejected: [],
  expired: [],
  succeeded: [],
  failed: [],
  needs_review: [],
};

/** Canonical JSON: sorted UTF-16 keys, preserved array order; rejects lossy JS values. */
export function canonicalJson(input: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  function encode(value: unknown, depth: number): string {
    if (depth > 64 || ++nodes > 100_000)
      throw new Error("JSON complexity limit");
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean")
      return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value))
      return JSON.stringify(value);
    if (typeof value !== "object" || !value) throw new Error("Non-JSON value");
    if (ancestors.has(value)) throw new Error("Circular JSON");
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Non-JSON object");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string"))
      throw new Error("Symbol keys are not JSON");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new Error("JSON properties must be plain data");
    }
    ancestors.add(value);
    let result: string;
    if (array) {
      if (keys.length !== value.length + 1)
        throw new Error("Sparse or extended array");
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor) throw new Error("Sparse array");
        items.push(encode(descriptor.value, depth + 1));
      }
      result = "[" + items.join(",") + "]";
    } else
      result =
        "{" +
        (keys as string[])
          .sort()
          .map(
            (key) =>
              JSON.stringify(key) +
              ":" +
              encode(descriptors[key]!.value, depth + 1),
          )
          .join(",") +
        "}";
    ancestors.delete(value);
    if (Buffer.byteLength(result, "utf8") > 1_000_000)
      throw new Error("JSON size limit");
    return result;
  }
  const result = encode(input, 0);
  if (Buffer.byteLength(result, "utf8") > 1_000_000)
    throw new Error("JSON size limit");
  return result;
}
export function bindAction(
  kind: ActionKind,
  payload: unknown,
  revisions: unknown,
): string {
  if (!actionKinds.includes(kind)) throw new Error("Unsupported action kind");
  return createHash("sha256")
    .update(canonicalJson({ kind, payload, revisions }))
    .digest("hex");
}
export function transition(from: ActionState, to: ActionState): ActionState {
  if (!Object.hasOwn(edges, from) || !edges[from].includes(to))
    throw new Error("Invalid action transition");
  return to;
}
export interface Action {
  id: string;
  kind: ActionKind;
  payload: unknown;
  revisions: unknown;
  state: ActionState;
}
export interface Approval {
  actionId: string;
  kind: ActionKind;
  binding: string;
  approvedBy: string;
  approvedAt: string;
}
export function approveAction(
  action: Action,
  actor: string,
  at: string,
): { action: Action; approval: Approval } {
  if (!actor.trim() || !Number.isFinite(Date.parse(at)) || !action.id.trim())
    throw new Error("Invalid approval identity or timestamp");
  const state = transition(action.state, "approved");
  const binding = bindAction(action.kind, action.payload, action.revisions);
  return {
    action: { ...action, state },
    approval: {
      actionId: action.id,
      kind: action.kind,
      binding,
      approvedBy: actor,
      approvedAt: at,
    },
  };
}
export function mutateAction(
  action: Action,
  payload: unknown,
  revisions: unknown,
): Action {
  if (
    !["proposed", "pending_approval", "approved", "invalidated"].includes(
      action.state,
    )
  )
    throw new Error("Action cannot be edited in this state");
  const before = bindAction(action.kind, action.payload, action.revisions);
  const after = bindAction(action.kind, payload, revisions);
  return {
    ...action,
    payload,
    revisions,
    state:
      action.state === "approved" && before !== after
        ? transition(action.state, "invalidated")
        : action.state,
  };
}
export function canExecute(action: Action, approval: Approval): boolean {
  return (
    action.state === "approved" &&
    action.id === approval.actionId &&
    action.kind === approval.kind &&
    bindAction(action.kind, action.payload, action.revisions) ===
      approval.binding
  );
}
