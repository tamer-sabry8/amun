import { z } from "zod";
const base = {
  version: z.literal(1),
  kind: z.literal("stakeholder"),
  productId: z.string().min(1).max(256).nullable(),
  request: z.uuid(),
};
const exact = {
  title: z.string().trim().min(1).max(256),
  text: z.string().min(1).max(100000),
};
const channel = z.enum(["pdf", "notion"]);
export const updateCommand = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.literal("draft"),
    objective: z.string().min(1).max(256).optional(),
  }),
  z.strictObject({ ...base, action: z.literal("restore") }),
  z.strictObject({ ...base, action: z.literal("review"), channel, ...exact }),
  z.strictObject({
    ...base,
    action: z.literal("approve"),
    channel,
    ...exact,
    id: z.uuid(),
    binding: z.hash("sha256"),
  }),
]);
export const updateResult = z.object({
  version: z.literal(1),
  kind: z.literal("stakeholder-result"),
  productId: z.string().nullable(),
  request: z.uuid(),
  title: z.string().optional(),
  text: z.string().optional(),
  draftText: z.string().optional(),
  review: z
    .object({
      id: z.uuid(),
      binding: z.hash("sha256"),
      destination: z.string(),
      channel,
    })
    .optional(),
  message: z.string().optional(),
});
