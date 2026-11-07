import { z } from "zod";
const id = z.string().min(1).max(256);
export const connectionSchema = z.strictObject({
  kind: z.enum(["ado", "github", "notion"]),
  baseUrl: z.string().url().max(2048),
});
const base = { version: z.literal(1), kind: z.literal("auth") };
const provider = z.enum([
  "github-copilot",
  "openrouter",
  "openai-codex",
  "openai",
  "anthropic",
]);
export const authCommand = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.literal("notion-target"),
    url: z.string().url().max(2048),
  }),
  z.strictObject({
    ...base,
    action: z.literal("notion-connect"),
    browser: z.enum(["edge", "dia"]),
  }),
  z.strictObject({
    ...base,
    action: z.enum(["notion-check", "notion-cancel", "notion-disconnect"]),
  }),
  z.strictObject({ ...base, action: z.literal("readiness"), provider }),
  z.strictObject({ ...base, action: z.literal("list") }),
  z.strictObject({
    ...base,
    action: z.literal("save"),
    connection: connectionSchema,
    secret: z.string().min(1).max(65536),
  }),
  z.strictObject({
    ...base,
    action: z.enum(["check", "forget"]),
    connection: connectionSchema,
  }),
  z
    .strictObject({
      ...base,
      action: z.literal("login"),
      provider,
      type: z.enum(["oauth", "api_key"]),
    })
    .refine((value) =>
      value.type === "oauth"
        ? ["github-copilot", "openrouter", "openai-codex"].includes(
            value.provider,
          )
        : ["openai", "openrouter", "anthropic"].includes(value.provider),
    ),
  z.strictObject({
    ...base,
    action: z.literal("answer"),
    id,
    answer: z.string().max(65536),
  }),
  z.strictObject({ ...base, action: z.literal("cancel") }),
]);
const status = z.enum([
  "missing",
  "configured",
  "checking",
  "ready",
  "error",
  "cancelled",
]);
export const authEvent = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("auth-status"),
    id,
    status,
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("auth-connections"),
    connections: z.array(connectionSchema.extend({ id, status })).max(100),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("auth-prompt"),
    id,
    method: z.enum(["text", "secret", "manual_code", "select"]),
    message: z.string().max(4096),
    options: z
      .array(
        z.strictObject({
          id: z.string().max(256),
          label: z.string().max(1024),
        }),
      )
      .max(64),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("auth-notice"),
    message: z.string().max(4096),
  }),
]);
export type AuthCommand = z.infer<typeof authCommand>;
export type AuthEvent = z.infer<typeof authEvent>;

export const modelLoginOptions: readonly {
  provider: string;
  type: "oauth" | "api_key";
  label: string;
}[] = [
  { provider: "github-copilot", type: "oauth", label: "GitHub Copilot" },
  { provider: "openrouter", type: "oauth", label: "OpenRouter" },
  { provider: "openai-codex", type: "oauth", label: "OpenAI / Codex" },
  { provider: "openai", type: "api_key", label: "OpenAI API key" },
  { provider: "openrouter", type: "api_key", label: "OpenRouter API key" },
  { provider: "anthropic", type: "api_key", label: "Anthropic API key" },
];
