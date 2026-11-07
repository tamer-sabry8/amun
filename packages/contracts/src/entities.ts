import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value);
const text = z.string().min(1).max(4096);
const timestamp = z.iso.datetime();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revisions = z.record(id, id);
const base = { id, productId: id };

export const attentionItem = z
  .strictObject({
    ...base,
    type: z.enum([
      "unblock",
      "answer",
      "decide",
      "approve",
      "review",
      "apply",
      "create",
      "go_to",
      "reconnect",
      "resolve_conflict",
    ]),
    origin: z.strictObject({
      kind: z.enum(["firstmate", "secondmate", "crewmate", "amun"]),
      label: text,
      firstmateRef: id.nullable(),
    }),
    ask: text,
    detail: z.string().max(16384),
    blocking: z.array(id).max(256),
    primaryAction: z.strictObject({
      label: text,
      mode: z.enum(["navigate", "inline"]),
      intent: z.enum(["open_request", "answer"]),
      targetRef: id,
    }),
    governed: z.boolean(),
    state: z.enum(["open", "resolved", "snoozed"]),
    snoozedUntil: timestamp.nullable(),
    createdAt: timestamp,
  })
  .superRefine((value, ctx) => {
    if (
      value.primaryAction.mode === "inline" &&
      (value.governed ||
        value.type !== "answer" ||
        value.primaryAction.intent !== "answer")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryAction"],
        message: "Only non-governed answers may be completed inline",
      });
    }
    if ((value.state === "snoozed") !== (value.snoozedUntil !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["snoozedUntil"],
        message: "Only snoozed requests require a snooze timestamp",
      });
    }
  });

export const notification = z.strictObject({
  ...base,
  kind: z.enum([
    "publication_finished",
    "sync_completed",
    "run_completed",
    "reminder_due",
    "connection_restored",
    "failure",
  ]),
  text,
  ref: id,
  readAt: timestamp.nullable(),
  createdAt: timestamp,
});
export const statusActivity = z.strictObject({
  ...base,
  productId: id.nullable(),
  kind: z.enum([
    "run",
    "publication",
    "story_preparation",
    "sync",
    "reconciliation",
    "runtime_health",
    "action",
  ]),
  state: z.enum(["working", "waiting", "failed", "completed"]),
  ref: id,
  text,
});
export const actionKind = z.enum([
  "publish",
  "commit",
  "merge",
  "notion_publish",
  "github_issue",
  "file_destructive",
  "skill_install",
  "model_outside_allowlist",
]);
export const action = z.strictObject({
  ...base,
  kind: actionKind,
  payload: z.json(),
  payloadHash: hash,
  targetRevisions: revisions,
  state: z.enum([
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
  ]),
  requestedBy: id,
  operationMarker: id,
});
export const approval = z.strictObject({
  id,
  subject: z.strictObject({ kind: z.enum(["action", "prd_version"]), id }),
  decision: z.enum(["approved", "rejected"]),
  payloadHash: hash,
  targetRevisions: revisions,
  approvedBy: id,
  approvedAt: timestamp,
  invalidatedReason: text.nullable(),
});
export const run = z.strictObject({
  ...base,
  storyId: id.nullable(),
  agentRole: text,
  harness: z.enum(["claude_code", "codex", "pi"]),
  model: id,
  firstmateTaskId: id,
  backend: z.enum(["herdr", "tmux"]),
  paneRef: id,
  worktree: text,
  branch: id,
  state: z.enum([
    "queued",
    "running",
    "awaiting_decision",
    "blocked",
    "completed",
    "failed",
    "cancelled",
    "unknown",
  ]),
  startedAt: timestamp.nullable(),
});
export type AttentionItem = z.infer<typeof attentionItem>;
export type Notification = z.infer<typeof notification>;
export type StatusActivity = z.infer<typeof statusActivity>;
export type Action = z.infer<typeof action>;
export type Approval = z.infer<typeof approval>;
export type Run = z.infer<typeof run>;
