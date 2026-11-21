import { z } from "zod";
const id = z.string().min(1).max(256);
const context = {
  version: z.literal(1),
  kind: z.literal("backlog-read"),
  requestId: z.uuid(),
  productId: id,
  sourceId: id,
};
export const backlogRead = z.discriminatedUnion("action", [
  z.strictObject({ ...context, action: z.literal("teams") }),
  z.strictObject({ ...context, action: z.literal("schema") }),
  z.strictObject({ ...context, action: z.literal("sprints"), team: id }),
  z.strictObject({
    ...context,
    action: z.literal("sprint-items"),
    team: id,
    sprint: id,
    workAreaId: id.optional(),
  }),
  z.strictObject({ ...context, action: z.literal("options"), team: id }),
  z.strictObject({
    ...context,
    action: z.literal("cards"),
    details: z.boolean().optional(),
    team: id,
    level: id,
  }),
]);
const named = z.object({ id, name: id });
const card = z.object({
  id: z.number().int().positive(),
  rev: z.number().int().positive(),
  title: z.string(),
  state: z.string(),
  type: z.string(),
  column: z.string().nullable(),
  iteration: z.string().nullable().optional(),
  rank: z
    .object({
      field: z.enum([
        "Microsoft.VSTS.Common.StackRank",
        "Microsoft.VSTS.Common.BacklogPriority",
      ]),
      value: z.number(),
    })
    .optional(),
  prerequisites: z.array(z.int().positive()).optional(),
  assignee: z.string().optional(),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  estimates: z
    .array(z.object({ name: z.string(), value: z.number() }))
    .optional(),
  blocked: z.string().optional(),
  description: z.string().optional(),
  criteria: z.string().optional(),
  readableCriteria: z.boolean().optional(),
});
export const planningIdentity = z.object({ id, name: id, uniqueName: id });
export const criteriaEdit = z.object({
  from: z.string().max(65536),
  text: z.string().max(16000),
});
export const statusEdit = z.object({ from: id, to: id });
export const ownerEdit = z.object({
  from: id.nullable(),
  to: planningIdentity,
});
const column = named.extend({
  stateMappings: z.record(z.string(), z.string()),
  isSplit: z.boolean(),
});
const common = {
  kind: z.literal("backlog-result"),
  requestId: z.uuid(),
  productId: id,
};
export const azureProcessSchema = z.object({
  process: z.string().nullable(),
  areas: z.array(z.string()),
  iterations: z.array(z.string()),
  types: z.array(
    z.object({
      name: id,
      states: z.array(id),
      fields: z.array(
        z.object({
          name: id,
          referenceName: id,
          required: z.boolean(),
          allowedValues: z.array(z.string()),
          defaultValue: z
            .union([z.string(), z.number(), z.boolean()])
            .nullable(),
        }),
      ),
    }),
  ),
});
export type AzureProcessSchema = z.infer<typeof azureProcessSchema>;
export const backlogResult = z.discriminatedUnion("view", [
  z.object({
    ...common,
    view: z.literal("schema"),
    schema: azureProcessSchema,
  }),
  z.object({ ...common, view: z.literal("error"), message: z.string() }),
  z.object({ ...common, view: z.literal("teams"), teams: z.array(named) }),
  z.object({
    ...common,
    view: z.literal("sprints"),
    sourceId: id.optional(),
    team: named,
    sprints: z.array(
      z.object({
        id,
        name: id,
        path: id,
        start: z.string().max(64),
        finish: z.string().max(64),
      }),
    ),
  }),
  z.object({
    ...common,
    view: z.literal("sprint-items"),
    sprint: id,
    items: z.array(
      z.object({
        id: z.number().int().positive(),
        title: z.string(),
        type: z.string(),
        state: z.string(),
        assignee: z.string().nullable(),
        points: z.number().optional(),
        labels: z.array(z.string()).optional(),
        indicator: z
          .object({ rev: z.int().positive(), blocked: z.boolean() })
          .optional(),
      }),
    ),
    more: z.boolean(),
  }),
  z.object({
    ...common,
    view: z.literal("options"),
    levels: z.array(named),
  }),
  z.object({
    ...common,
    view: z.literal("cards"),
    columns: z.array(column),
    cards: z.array(card),
    identities: z.array(planningIdentity).optional(),
    transitions: z
      .record(z.string(), z.record(z.string(), z.array(z.string())))
      .optional(),
    creationTarget: z
      .object({ type: id, area: id, backlogIteration: id })
      .nullable()
      .optional(),
    backlogIteration: z.string().nullable().optional(),
    canEditBoard: z.boolean(),
  }),
]);
export type BacklogResult = z.infer<typeof backlogResult>;
const value = z.union([
  z.string().max(16000),
  z.number().finite(),
  z.boolean(),
]);
const operationContext = {
  version: z.literal(1),
  kind: z.literal("ado-operation"),
  requestId: z.uuid(),
  productId: id,
  sourceId: id,
  team: id,
};
export const operationItem = z.strictObject({
  duplicateDecision: z.enum(["edit-existing", "create-separately"]).optional(),
  targetId: z.int().positive().optional(),
  id,
  title: z.string().min(1).max(256),
  type: id,
  fields: z.record(z.string(), value),
});
export const reviewedOrder = z.object({
  beforeId: z.int().positive(),
  anchorRev: z.int().positive(),
  oldNext: z.int().positive().nullable(),
});
export const plannedStory = z.object({
  localId: z.uuid(),
  title: z.string().trim().min(1).max(256),
  criteria: z.array(z.string().trim().min(1).max(2048)).max(20),
  labels: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[^;\r\n]+$/),
    )
    .max(30),
  schedule: z.boolean(),
  separate: z.boolean().optional(),
});
export type PlannedStory = z.infer<typeof plannedStory>;
export const sprintMoveRequest = z.strictObject({
  ...operationContext,
  action: z.literal("apply-sprint-moves"),
  ref: z.string().regex(/^amun-r-[0-9a-f]{12}$/),
  space: id,
  workAreaId: id,
  chatId: id,
  level: id,
  sprintId: id,
  iteration: id,
  creates: z.array(plannedStory).max(100).optional(),
  creationTarget: z
    .object({ type: id, area: id, backlogIteration: id })
    .optional(),
  moves: z
    .array(
      z.strictObject({
        id: z.int().positive(),
        rev: z.int().positive(),
        from: id,
        to: id,
        addLabels: z
          .array(
            z
              .string()
              .trim()
              .min(1)
              .max(128)
              .regex(/^[^;\r\n]+$/),
          )
          .min(1)
          .max(30)
          .optional(),
        targetSprintId: id.optional(),
        reorder: reviewedOrder.optional(),
        criteria: criteriaEdit.optional(),
        status: statusEdit.optional(),
        owner: ownerEdit.optional(),
        title: z.string().max(1024),
      }),
    )
    .max(100),
});
export type SprintMoveRequest = z.infer<typeof sprintMoveRequest>;
export const goalSuggestion = z.object({
  id: z.int().positive(),
  rev: z.int().positive(),
  reason: z.string().min(1).max(1024),
  ownerId: id.optional(),
  evidenceId: z.int().positive().optional(),
});
export const adoOperation = z.discriminatedUnion("action", [
  z.strictObject({
    ...operationContext,
    action: z.literal("suggest-sprint-stories"),
    space: id,
    ref: z.string().regex(/^amun-r-[0-9a-f]{12}$/),
    workAreaId: id,
    chatId: id,
    level: id,
    sprintId: id,
    goal: z.string().trim().min(1).max(2048),
    tag: z.string().max(128).optional(),
  }),
  sprintMoveRequest,
  z.strictObject({
    ...operationContext,
    action: z.literal("compare-prd"),
    level: id,
    objectiveId: id,
    versionNumber: z.int().positive(),
    workAreaId: id,
    chatId: id.nullable(),
    space: id,
    ref: z.string().regex(/^amun-r-[0-9a-f]{12}$/),
  }),
  z.strictObject({
    ...operationContext,
    action: z.literal("inspect-sprint-submission"),
    workAreaId: id,
    sprintId: id,
    ref: z.string().regex(/^amun-r-[0-9a-f]{12}$/),
  }),
  z.strictObject({
    ...operationContext,
    action: z.literal("keep-observed-sprint"),
    space: id,
    workAreaId: id,
    sprintId: id,
    ref: z.string().regex(/^amun-r-[0-9a-f]{12}$/),
    itemId: z.int().positive(),
    rev: z.int().positive(),
    iteration: id,
  }),
  z.strictObject({ ...operationContext, action: z.literal("targets") }),
  z.strictObject({
    ...operationContext,
    action: z.literal("preview"),
    level: id.optional(),
    intent: z.enum(["publish", "commit"]),
    area: id,
    iteration: id,
    assignee: z.string().max(256),
    items: z.array(operationItem).min(1).max(100),
  }),
  z.strictObject({
    ...operationContext,
    action: z.literal("approve-execute"),
    origin: z.object({ areaId: id, chatId: id.nullable() }).optional(),
    ref: z
      .string()
      .regex(/^amun-r-[0-9a-f]{12}$/)
      .optional(),
    space: id.optional(),
    batchId: z.uuid(),
    binding: z.string().length(64),
  }),
  z.strictObject({
    ...operationContext,
    action: z.literal("reconcile"),
    batchId: z.uuid(),
    binding: z.string().length(64),
  }),
  z.strictObject({
    ...operationContext,
    action: z.literal("edit"),
    itemId: z.int().positive(),
    revision: z.int().positive(),
    level: id,
    title: z.string().min(1).max(256),
    column: id,
  }),
]);
export type AdoOperation = z.infer<typeof adoOperation>;
export const operationResult = z.object({
  kind: z.literal("ado-operation-result"),
  requestId: z.uuid(),
  productId: id,
  message: z.string(),
  iterations: z.array(z.string()).optional(),
  batchId: z.string().optional(),
  binding: z.string().optional(),
  preview: z.string().optional(),
  requestRef: z.string().optional(),
  suggestions: z.array(goalSuggestion).optional(),
  receipts: z
    .array(
      z.object({
        itemId: id,
        state: id,
        remoteId: z.number().nullable(),
        remoteRev: z.number().nullable(),
      }),
    )
    .optional(),
});
