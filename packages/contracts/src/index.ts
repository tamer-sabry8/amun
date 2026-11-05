import { z } from "zod";

const id = z.string().trim().min(1).max(256);
export const healthRequest = z.strictObject({
  version: z.literal(1),
  id,
  method: z.literal("health"),
  params: z.strictObject({}),
});
export const healthResponse = z.strictObject({
  version: z.literal(1),
  id,
  status: z.enum(["ready", "reconnecting", "failed"]),
});
export type HealthRequest = z.infer<typeof healthRequest>;
export type HealthResponse = z.infer<typeof healthResponse>;
