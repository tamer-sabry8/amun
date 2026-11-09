import { z } from "zod";
export const prototypeDesign = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    elements: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
          label: z.string().trim().min(1).max(160),
          description: z.string().trim().min(1).max(2000),
        }),
      )
      .min(1)
      .max(16),
  })
  .refine(
    (d) => new Set(d.elements.map((e) => e.id)).size === d.elements.length,
  );
const base = {
  version: z.literal(1),
  kind: z.literal("prototype"),
  id: z.uuid(),
  product: z.string().min(1),
  objective: z.string().min(1),
  revision: z.number().int().positive(),
};
export const prototypeCommand = z.strictObject({
  ...base,
  action: z.enum(["start", "preview", "feedback"]),
});
export const prototypeResult = z.object({
  kind: z.literal("prototype-result"),
  id: z.uuid(),
  product: z.string(),
  objective: z.string(),
  message: z.string(),
  url: z.url().optional(),
  proposal: z.boolean().optional(),
});
