import { z } from "zod";
export const deliveryChecklist = [
  "Story status reviewed",
  "Merge verified",
  "Test evidence reviewed",
] as const;
export const targetSchema = z.strictObject({
  product: z.string().min(1),
  repo: z.url({ protocol: /^https$/ }),
  number: z.number().int().positive(),
  method: z.enum(["merge", "squash", "rebase"]),
  base: z.string().min(1),
});
export type MergeTarget = z.infer<typeof targetSchema>;

export const prRevision = z.object({
  head: z.string().regex(/^[a-f0-9]{40}$/),
});
const key = z.string().min(1).max(512);
export const prRow = z.object({
  number: z.number().int().positive(),
  title: key,
  source: key,
  url: z.url(),
  provider: z.enum(["GitHub", "Azure Repos"]),
});
export const prDetail = z.object({
  sourceBranch: key,
  head: z.string().regex(/^[a-f0-9]{40}$/),
  base: key,
  merged: z.boolean(),
  permitted: z.boolean(),
  ready: z.boolean(),
  methods: z.array(z.enum(["squash", "merge", "rebase"])),
  title: key,
  summary: z.string().max(32768),
  files: z.array(z.string()).max(300),
  checks: z.array(z.string()),
  reviews: z.array(z.string()),
  threads: z.array(z.string()),
  votes: z.array(z.enum(["comment", "approve", "changes"])),
});
export type PullDetail = z.infer<typeof prDetail>;
const base = {
  version: z.literal(1),
  kind: z.literal("pr-workspace"),
  id: z.uuid(),
  product: key,
};
const selected = { ...base, source: key, number: z.number().int().positive() };
const bound = {
  ...selected,
  reviewId: z.uuid(),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
  method: z.enum(["squash", "merge", "rebase"]),
  base: key,
};
export const prCommand = z.discriminatedUnion("action", [
  z.strictObject({ ...base, action: z.literal("list") }),
  z.strictObject({ ...selected, action: z.literal("details") }),
  z.strictObject({
    ...selected,
    action: z.literal("file"),
    path: key,
    head: key,
  }),
  z.strictObject({
    ...selected,
    action: z.literal("review"),
    head: key,
    vote: z.enum(["comment", "approve", "changes"]),
    body: z.string().trim().min(1).max(10000),
  }),
  z.strictObject({
    ...selected,
    action: z.literal("prepare"),
    method: z.enum(["squash", "merge", "rebase"]),
    head: key,
  }),
  z.strictObject({ ...bound, action: z.enum(["approve", "execute"]) }),
  z.strictObject({
    ...bound,
    action: z.literal("accept"),
    story: key,
    verdict: z.enum(["Accepted", "Rejected", "Blocked"]),
    rationale: key,
    checks: z.array(key).min(1).max(30),
  }),
]);
export const prResult = z.strictObject({
  kind: z.literal("pr-result"),
  id: z.uuid(),
  product: key,
  message: z.string(),
  rows: z.array(prRow).optional(),
  detail: prDetail.optional(),
  diff: z
    .object({ before: z.string().max(524288), after: z.string().max(524288) })
    .optional(),
  review: z
    .object({
      id: z.uuid(),
      binding: key,
      head: key,
      base: key,
      method: z.enum(["squash", "merge", "rebase"]),
      state: key,
      stories: z.array(z.object({ id: key, title: key })),
      decisions: z.array(
        z.object({ story: key, verdict: key, rationale: key, at: key }),
      ),
    })
    .optional(),
});
