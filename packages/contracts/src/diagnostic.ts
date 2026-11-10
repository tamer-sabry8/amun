import { z } from "zod";

// The renderer may send only measurements. No free text, URLs or payloads.
export const diagnosticEvent = z.strictObject({
  version: z.literal(1),
  kind: z.literal("diagnostic"),
  event: z.enum([
    "dialog-frame",
    "login-first-dialog",
    "provider-error",
    "renderer-error",
    "unhandled-rejection",
  ]),
  subject: z.enum([
    "auth",
    "search",
    "draft",
    "dialog",
    "renderer",
    "github-copilot",
    "openrouter",
    "openai-codex",
    "openai",
    "anthropic",
  ]),
  elapsedMs: z.number().int().min(0).max(3600000).nullable(),
});
export type DiagnosticEvent = z.infer<typeof diagnosticEvent>;
