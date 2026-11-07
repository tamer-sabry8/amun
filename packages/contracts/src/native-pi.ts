import { hostingDestination } from "./hosting.ts";
import { z } from "zod";
const base = { version: z.literal(1), kind: z.literal("native-pi") };
const id = z.string().min(1).max(128);
export const nativePiCommand = z.discriminatedUnion("action", [
  z
    .strictObject({
      ...base,
      action: z.literal("run"),
      id,
      command: z.string().regex(/^[a-z][a-z-]{0,63}$/),
      argument: z.string().max(524288),
    })
    .refine(
      (value) =>
        value.command === "import-preview" || value.argument.length <= 16384,
    ),
  z.strictObject({ ...base, action: z.literal("abort-turn"), id }),
  z.strictObject({ ...base, action: z.literal("close") }),
]);
export const nativeTurnRequest = z.strictObject({
  sessionId: z.uuid(),
  model: z.string().min(1).max(512),
  text: z
    .string()
    .min(1)
    .max(12000)
    .refine(
      (s) =>
        Boolean(s.trim()) && !s.includes("\0") && !/^[!\/]/.test(s.trimStart()),
    ),
});
export const notionApprovalRequest = z.strictObject({
  reviewId: z.uuid(),
  binding: z.string().regex(/^[a-f0-9]{64}$/),
});
export const nativePiResult = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("hosting-setup"),
    destination: hostingDestination.nullable(),
  }),
  z.strictObject({
    kind: z.literal("github-device"),
    code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  }),
  z.strictObject({
    kind: z.literal("publication-receipts"),
    pages: z
      .array(
        z.strictObject({
          id: z.uuid(),
          title: z.string().max(256),
          url: z.string().regex(/^https:\/\/www\.notion\.so\/[a-f0-9]{32}$/i),
        }),
      )
      .max(50),
  }),
  z.strictObject({
    kind: z.literal("conversation"),
    model: z.string().min(1).max(512).nullable(),
    sessionId: z.uuid(),
    title: z.string().max(256),
    text: z.string().max(262144),
    omittedItems: z.number().int().min(0).max(10000),
  }),
  z.strictObject({
    kind: z.literal("import-review"),
    token: z.uuid(),
    sessionId: z.uuid(),
    originalCwd: z.string().max(4096),
    targetCwd: z.string().max(4096),
    entries: z.number().int().min(0).max(4096),
    removedParent: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("notion-review"),
    reviewId: z.uuid(),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().max(256),
    text: z.string().max(262144),
    destination: z.string().max(256),
    destinationId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("notion-preview"),
    title: z.string().max(256),
    text: z.string().max(262144),
    omittedItems: z.number().int().min(0).max(10000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    kind: z.literal("document"),
    title: z.string().max(256),
    text: z.string().max(60000),
    page: z.number().int().min(0).max(128),
    totalPages: z.number().int().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("preferences"),
    fields: z
      .array(
        z.strictObject({
          id: z.string().max(64),
          label: z.string().max(128),
          value: z.string().max(128),
          options: z.array(z.string().max(128)).max(32),
        }),
      )
      .max(32),
  }),
  z.strictObject({
    kind: z.literal("export"),
    format: z.enum(["html", "jsonl"]),
    text: z.string().max(524288),
    review: z.string().max(524288),
  }),
  z.strictObject({
    kind: z.literal("choices"),
    title: z.string().max(256),
    choices: z
      .array(
        z.strictObject({ id: z.string().max(512), label: z.string().max(256) }),
      )
      .max(2048),
  }),
  z.strictObject({
    kind: z.enum(["message", "copy"]),
    text: z.string().max(262144),
  }),
  z.strictObject({
    kind: z.literal("stats"),
    values: z
      .array(
        z.strictObject({
          label: z.string().max(128),
          value: z.number().finite().nonnegative(),
        }),
      )
      .max(32),
  }),
]);
export const nativePiEvent = z.strictObject({
  version: z.literal(1),
  kind: z.literal("native-pi-result"),
  id,
  result: nativePiResult,
});
export type NativePiEvent = z.infer<typeof nativePiEvent>;
