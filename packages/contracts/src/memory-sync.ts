import { z } from "zod";
const id = z.string().min(1).max(256);
export const fieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{0,63}$/);
export const syncValue = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\r\n\0]+$/);
export const memoryLink = z.object({
  id,
  record: id,
  field: fieldName,
  label: fieldName,
  page: z.uuid(),
  state: z.enum([
    "pending",
    "kept",
    "unconfirmed",
    "synced",
    "outgoing",
    "incoming",
    "conflict",
    "deleted",
    "unavailable",
  ]),
  local: z.string(),
  remote: z.string().nullable(),
  baseline: z.string().nullable(),
});
export type MemoryLink = z.infer<typeof memoryLink>;
const base = {
  version: z.literal(1),
  kind: z.literal("workspace"),
  productId: id,
};
export const syncCommand = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.literal("link-memory"),
    record: id,
    field: fieldName,
    label: fieldName,
    url: z.string().max(2048),
  }),
  z.strictObject({
    ...base,
    action: z.literal("edit-memory-field"),
    link: id,
    before: z.string(),
    value: syncValue,
  }),
  z.strictObject({
    ...base,
    action: z.literal("sync-memory-field"),
    link: id,
    choice: z.enum([
      "refresh",
      "take-remote",
      "publish-local",
      "unlink",
      "keep-local",
      "delete-local",
    ]),
    review: memoryLink,
  }),
]);

export type SyncCommand = z.infer<typeof syncCommand>;
