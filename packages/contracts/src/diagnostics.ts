import { z } from "zod";

export const diagnosticsRequest = z.strictObject({
  version: z.literal(1),
  kind: z.literal("diagnostics"),
  id: z.string().trim().min(1).max(128),
});
export const diagnosticsResult = z.strictObject({
  version: z.literal(1),
  kind: z.literal("diagnostics-result"),
  id: z.string().min(1).max(128),
  text: z.string().max(524288),
});
export type DiagnosticsRequest = z.infer<typeof diagnosticsRequest>;
export type DiagnosticsResult = z.infer<typeof diagnosticsResult>;
