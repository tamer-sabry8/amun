import { z } from "zod";

const short = z.string().min(1).max(512);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/** What the owner reads before a crewmate's code change becomes a pull request. */
export const codeChangeCard = z.strictObject({
  id: z.uuid(),
  product: short,
  repo: z.strictObject({ owner: short, name: short, url: z.url() }),
  base: short,
  branch: z.string().regex(/^amun\/[a-z0-9][a-z0-9-]{0,60}$/),
  message: z.string().min(1).max(4096),
  title: z.string().max(512).optional(),
  body: z.string().max(4096).optional(),
  files: z
    .array(
      z.strictObject({
        path: short,
        status: z.enum(["added", "changed", "removed", "renamed"]),
        additions: z.number().int().nonnegative(),
        deletions: z.number().int().nonnegative(),
      }),
    )
    .max(300),
  diff: z.string().max(524288),
  diffHash: hash,
  binding: hash,
  state: z.enum([
    "waiting",
    "approved",
    "opening",
    "open",
    "unconfirmed",
    "declined",
    "failed",
  ]),
  /** Plain words explaining why approving is not possible right now. */
  blocker: z.string().max(512).optional(),
  pull: z
    .strictObject({
      number: z.number().int().positive(),
      url: z.url(),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
    })
    .optional(),
});
export type CodeChangeCard = z.infer<typeof codeChangeCard>;

const base = {
  version: z.literal(1),
  kind: z.literal("code-change"),
  id: z.uuid(),
  product: short,
  /** The work area the pane is open in. */
  workAreaId: short.optional(),
};
export const codeChangeCommand = z.discriminatedUnion("action", [
  z.strictObject({ ...base, action: z.literal("list") }),
  z.strictObject({
    ...base,
    action: z.literal("approve"),
    reviewId: z.uuid(),
    binding: hash,
  }),
  z.strictObject({
    ...base,
    action: z.literal("changes"),
    reviewId: z.uuid(),
    note: z.string().trim().min(1).max(4000),
  }),
]);
export const codeChangeResult = z.strictObject({
  kind: z.literal("code-change-result"),
  id: z.uuid(),
  product: short,
  message: z.string().max(1024),
  cards: z.array(codeChangeCard),
});
export type CodeChangeResult = z.infer<typeof codeChangeResult>;
