import { modelRoute, routingReview, difficulty } from "./model-routing.ts";
import { z } from "zod";
import { attentionItem, notification, statusActivity } from "./entities.ts";
const id = z.string().min(1).max(256);
export const themeName = z.enum([
  "tamer-sabry-default",
  "navy-gold",
  "navy-cyan",
]);
export const uiPreferences = z.strictObject({
  theme: themeName.default("tamer-sabry-default"),
  productId: id.nullable().default(null),
  islandSize: z.enum(["pill", "card", "expanded"]).default("card"),
  pinnedTabs: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1).max(256),
        route: z.string().min(1).max(256),
      }),
    )
    .max(100)
    .default([]),
});
export const interviewQuestion = z.strictObject({
  question: z.string().trim().min(4).max(1500),
  sourceIds: z.array(z.string()).min(1).max(50),
});
const md = z.string().min(1).max(100000);
const docVersion = z.int().nonnegative();
const docTarget = {
  productId: id,
  objectiveId: id,
  expectedVersion: docVersion,
};
const modelBase = {
  difficulty: difficulty.optional(),
  version: z.literal(1),
  kind: z.literal("product-authoring"),
  productId: id,
  model: id,
};
export const decisionOptions = z.strictObject({
  question: z.string().trim().min(1).max(1024),
  options: z.array(z.string().trim().min(1).max(512)).min(2).max(8),
  proposed: z.string().min(1).max(512),
  missing: z.string().max(2048),
});
export const storyDecision = decisionOptions.extend({
  id,
  itemId: id,
  requirementId: id,
  state: z.enum(["open", "snoozed", "resolved"]),
  createdAt: z.string(),
  choice: z.string(),
  confirmation: z.string(),
  requested: z.boolean(),
});
export type StoryDecision = z.infer<typeof storyDecision>;
export const storyBundle = z.object({
  stories: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1).max(256),
        requirement: z.string().trim().min(1).max(4096),
        acceptance: z.array(z.string().trim().min(1).max(2048)).min(1).max(20),
        tasks: z.array(z.string().trim().min(1).max(256)).max(20),
      }),
    )
    .min(1)
    .max(30),
});
export const storyDraft = z.object({
  id,
  title: z.string(),
  type: z.string(),
  parentId: id.nullable(),
  objectiveId: id,
  version: docVersion,
  requirement: z.string(),
  requirementId: id,
  status: z.string(),
  acceptance: z.array(z.string()),
});
export const productAuthoring = z.discriminatedUnion("action", [
  z.strictObject({
    ...modelBase,
    action: z.literal("story-decision"),
    itemId: id,
  }),
  z.strictObject({ ...modelBase, ...docTarget, action: z.literal("stories") }),
  z.strictObject({
    ...modelBase,
    action: z.literal("interview"),
    objective: z.string().trim().min(1).max(4096),
  }),
  z.strictObject({
    ...modelBase,
    ...docTarget,
    action: z.enum(["draft", "critique"]),
    understandingVersion: z.int().positive(),
    selection: z.string().max(4096),
  }),
]);
export const documentProposal = z.strictObject({
  markdown: md,
  sourceIds: z.array(id).min(1).max(50),
  rationale: z.string().min(1).max(4096),
});
export const prdRecord = z.strictObject({
  version: docVersion,
  markdown: md,
  approved: z.boolean(),
  invalidated: z.string().nullable(),
  history: z.array(z.strictObject({ version: docVersion, markdown: md })),
});
export const pendingProposal = z.strictObject({
  id,
  markdown: md,
  rationale: z.string(),
  baseVersion: docVersion,
});

export const documentImport = z.strictObject({
  version: z.literal(1),
  kind: z.literal("document-import"),
  productId: id,
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\\x00-\x1f]+$/),
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength <= 8 * 1024 * 1024),
});
const reviewText = z.string().trim().max(12000);
const understandingFields = {
  facts: reviewText.min(1),
  assumptions: reviewText,
  questions: reviewText,
};
export const understandingRecord = z.strictObject({
  ...understandingFields,
  version: z.int().positive(),
  approved: z.boolean(),
});
const revision = z.int().nonnegative();
const riceInputs = {
  reach: z.number().nullable(),
  impact: z.number().nullable(),
  confidence: z.number().nullable(),
  effort: z.number().nullable(),
};
const priorityFields = {
  objective: z.string().trim().min(1).max(512),
  release: z.string().trim().max(128),
  status: z.enum(["Proposed", "Planned", "In progress", "Done"]),
  evidence: z.string().trim().max(2048),
  ...riceInputs,
};
const modelList = z.array(z.string().trim().min(1).max(256)).max(100);
const base = { version: z.literal(1), kind: z.literal("workspace") };
export const workspaceCommand = z.discriminatedUnion("action", [
  modelRoute.extend({
    ...base,
    action: z.literal("save-model-route"),
    productId: id,
  }),
  z.strictObject({
    ...base,
    action: z.literal("approve-model-route"),
    productId: id,
    reviewId: z.uuid(),
    binding: z.string().length(64),
  }),
  z.strictObject({
    ...base,
    action: z.literal("review-story-decision"),
    operation: z.enum(["save", "request", "later", "resolve"]),
    productId: id,
    requestId: id,
    choice: z.string().max(512),
    confirmation: z.string().max(2048),
  }),
  z.strictObject({ ...base, action: z.literal("snapshot") }),
  z.strictObject({
    ...base,
    ...docTarget,
    action: z.literal("prd-selection"),
    selection: z.string().trim().min(1).max(4096),
    intent: z.enum(["link", "story", "source", "assumption"]),
  }),
  z.strictObject({
    ...base,
    action: z.literal("product-models"),
    productId: id,
    allowedModels: modelList,
  }),
  z.strictObject({
    ...base,
    action: z.literal("save-priority"),
    productId: id,
    priorityId: id,
    ...priorityFields,
  }),
  z.strictObject({
    ...base,
    ...docTarget,
    action: z.enum(["save-prd", "approve-prd"]),
    markdown: md,
  }),
  z.strictObject({
    ...base,
    ...docTarget,
    action: z.enum(["apply-proposal", "dismiss-proposal"]),
    proposalId: id,
  }),
  z.strictObject({
    ...base,
    action: z.literal("save-understanding"),
    productId: id,
    objectiveId: id,
    expectedVersion: revision,
    ...understandingFields,
  }),
  z.strictObject({
    ...base,
    action: z.literal("approve-understanding"),
    productId: id,
    objectiveId: id,
    expectedVersion: revision,
  }),
  z.strictObject({
    ...base,
    action: z.literal("pin-decision"),
    productId: id,
    sourceId: id,
    text: z.string().trim().min(1).max(4096),
  }),
  z.strictObject({
    ...base,
    action: z.literal("create-product"),
    name: z.string().trim().min(1).max(256),
    allowedModels: modelList,
  }),
  z.strictObject({
    ...base,
    action: z.literal("map-source"),
    productId: id,
    title: z.string().trim().min(1).max(512),
    reference: z.string().trim().min(1).max(2048),
    sourceKind: z.enum(["document", "repo", "ado", "notion"]),
  }),
  z.strictObject({
    ...base,
    action: z.literal("preferences"),
    preferences: uiPreferences,
  }),
  z.strictObject({
    ...base,
    action: z.literal("snooze"),
    id,
    until: z.iso.datetime(),
  }),
  z.strictObject({
    ...base,
    action: z.literal("resolve"),
    id,
    source: z.enum(["island", "review"]),
    answer: z.string().max(16384).optional(),
  }),
  z.strictObject({
    ...base,
    action: z.literal("search"),
    productId: id.nullable(),
    query: z.string().max(512),
  }),
]);
export const workspaceSnapshot = z.strictObject({
  version: z.literal(1),
  kind: z.literal("workspace-snapshot"),
  preferences: uiPreferences,
  products: z
    .array(z.strictObject({ id, name: z.string().min(1).max(4096) }))
    .max(1000),
  productContext: z
    .strictObject({
      productId: id,
      allowedModels: z.array(id),
      routes: z.array(modelRoute).default([]),
      modelRuns: z.array(z.object({ id, task: id, model: id })).default([]),
      routingReviews: z.array(routingReview).default([]),
      storyDecisions: z.array(storyDecision).default([]),
      storyDrafts: z.array(storyDraft).default([]),
      priorities: z.array(
        z.strictObject({ id, ...priorityFields, score: z.number().nullable() }),
      ),
      objectives: z.array(
        z.strictObject({
          id,
          statement: z.string(),
          question: z.string(),
          answer: z.string().nullable(),
          understanding: understandingRecord.nullable(),
          prd: prdRecord.nullable(),
          proposal: pendingProposal.nullable(),
          sourceIds: z.array(id),
          links: z.array(
            z.strictObject({
              id,
              version: docVersion,
              intent: z.string(),
              selection: z.string(),
              target: id,
            }),
          ),
        }),
      ),
      sources: z.array(
        z.strictObject({
          id,
          title: z.string(),
          kind: z.string(),
          reference: z.string().nullable(),
        }),
      ),
      memory: z.array(
        z.strictObject({ id, sourceId: id, type: z.string(), data: z.json() }),
      ),
    })
    .nullable()
    .default(null),
  attention: z.array(attentionItem).max(10000),
  activities: z.array(statusActivity).max(10000),
  notifications: z.array(notification).max(10000),
  artifacts: z
    .array(
      z.strictObject({
        id,
        productId: id,
        kind: z.string().max(128),
        ref: z.string().max(4096),
      }),
    )
    .max(10000),
  skills: z
    .array(
      z.strictObject({
        id,
        name: z.string().max(256),
        version: z.string().max(128),
        approvedAt: z.string().nullable(),
      }),
    )
    .max(1000),
});
export const workspaceEvent = z.discriminatedUnion("kind", [
  workspaceSnapshot,
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("workspace-search"),
    query: z.string().max(512),
    results: z
      .array(
        z.strictObject({
          id,
          kind: z.string().max(128),
          title: z.string().max(4096),
        }),
      )
      .max(50),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("workspace-error"),
    message: z.string().max(1024),
  }),
]);
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshot>;
export type WorkspaceEvent = z.infer<typeof workspaceEvent>;
export type UiPreferences = z.infer<typeof uiPreferences>;
