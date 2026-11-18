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

/**
 * The trace bundle: a redacted zip of chats, agent status, worktrees and the
 * daemon log, built by the daemon for the captain to save and share. A
 * diagnostics request answers with one of these, or a failure.
 */
export const traceBundle = z.strictObject({
  version: z.literal(1),
  kind: z.literal("trace-bundle"),
  id: z.string().min(1).max(128),
  fileName: z.string().min(1).max(256),
  size: z.number().int().nonnegative(),
  files: z.array(z.string().max(1024)).max(10000),
  base64: z.string(),
  /** Agent history: on, just requested from the First Mate, or off. */
  history: z.enum(["on", "asked", "off"]),
});
export const traceBundleFailed = z.strictObject({
  version: z.literal(1),
  kind: z.literal("trace-bundle-failed"),
  id: z.string().min(1).max(128),
  message: z.string().max(4096),
});
export type TraceBundle = z.infer<typeof traceBundle>;
export type TraceBundleFailed = z.infer<typeof traceBundleFailed>;
