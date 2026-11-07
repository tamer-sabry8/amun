import { z } from "zod";
export const release = z.object({
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Release = z.infer<typeof release>;
export const catalog = z.strictObject({
  current: release,
  previous: release.nullable(),
});
