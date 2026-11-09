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
  z.strictObject({ ...context, action: z.literal("options"), team: id }),
  z.strictObject({
    ...context,
    action: z.literal("cards"),
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
    view: z.literal("options"),
    levels: z.array(named),
  }),
  z.object({
    ...common,
    view: z.literal("cards"),
    columns: z.array(column),
    cards: z.array(card),
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
  id,
  title: z.string().min(1).max(256),
  type: id,
  fields: z.record(z.string(), value),
});
export const adoOperation = z.discriminatedUnion("action", [
  z.strictObject({ ...operationContext, action: z.literal("targets") }),
  z.strictObject({
    ...operationContext,
    action: z.literal("preview"),
    intent: z.enum(["publish", "commit"]),
    area: id,
    iteration: id,
    assignee: z.string().max(256),
    items: z.array(operationItem).min(1).max(100),
  }),
  z.strictObject({
    ...operationContext,
    action: z.literal("approve-execute"),
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
