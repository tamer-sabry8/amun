import { z } from "zod";
const id = z.string().min(1).max(256);
const base = { version: z.literal(1), kind: z.literal("pi") };
export const piOpen = z.strictObject({
  version: z.literal(1),
  kind: z.literal("pi"),
  action: z.literal("open-protocol"),
});
export const piCommand = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.literal("prompt"),
    message: z.string().min(1).max(16384),
  }),
  z.strictObject({
    ...base,
    action: z.literal("answer"),
    id,
    answer: z.union([z.string().max(4096), z.boolean(), z.null()]),
  }),
  z.strictObject({ ...base, action: z.enum(["abort", "close"]) }),
]);
export const piEvent = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("pi-text"),
    text: z.string().max(65536),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("pi-state"),
    state: z.enum(["ready", "running", "complete", "closed", "unavailable"]),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("pi-dialog"),
    id,
    method: z.enum(["select", "confirm"]),
    title: z.string().max(4096),
    options: z.array(z.string().max(4096)).max(64).optional(),
    message: z.string().max(8192).optional(),
  }),
]);
export type PiEvent = z.infer<typeof piEvent>;
