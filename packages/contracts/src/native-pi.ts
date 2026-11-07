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
        ["import-preview", "extension-review"].includes(value.command) ||
        value.argument.length <= 16384,
    ),
  z.strictObject({ ...base, action: z.literal("abort-turn"), id }),
  z.strictObject({
    ...base,
    action: z.literal("answer-extension"),
    id,
    dialog: z.uuid(),
    answer: z.union([z.string().max(4096), z.boolean(), z.null()]),
  }),
  z.strictObject({ ...base, action: z.literal("close") }),
]);
export const captainShellRequest = z.strictObject({
  sessionId: z.uuid(),
  command: z.string().min(1).max(8192),
  excludeFromContext: z.boolean(),
});
export const textAttachmentRequest = z.strictObject({
  sessionId: z.uuid(),
  draft: z.string().max(12000),
  name: z
    .string()
    .min(1)
    .max(255)
    .refine((name) => !/[\/\\\p{Cc}\p{Cf}]/u.test(name)),
  content: z
    .string()
    .min(1)
    .max(12000)
    .refine((text) => !/[\p{Cc}]/u.test(text.replace(/[\r\n\t]/g, ""))),
});
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
    kind: z.literal("extension-review"),
    id: z.uuid(),
    name: z.string().max(200),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().max(65536),
  }),
  z.strictObject({
    kind: z.literal("extension-dialog"),
    dialog: z.uuid(),
    method: z.enum(["confirm", "select", "input", "editor"]),
    title: z.string().max(256),
    message: z.string().max(4096),
    options: z.array(z.string().max(256)).max(128),
  }),
  z.strictObject({
    kind: z.literal("session-tree"),
    rows: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
          type: z.string().regex(/^\w{1,64}$/),
          depth: z.number().int().min(0).max(2047),
          current: z.boolean(),
        }),
      )
      .max(2048),
  }),
  z.strictObject({
    kind: z.literal("hosting-setup"),
    destination: hostingDestination.nullable(),
  }),
  z.strictObject({
    kind: z.literal("github-issue-review"),
    id: z.uuid(),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    owner: z.string().max(100),
    repo: z.string().max(100),
    title: z.string().max(256),
    body: z.string().max(4096),
  }),
  z.strictObject({
    kind: z.literal("github-device"),
    code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  }),
  z.strictObject({
    kind: z.literal("publication-receipts"),
    unconfirmed: z
      .array(
        z.strictObject({
          id: z.uuid(),
          delivery: z
            .enum(["not sent", "sent-unknown", "confirmed"])
            .optional(),
          title: z.string().max(256),
        }),
      )
      .max(50)
      .default([]),
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
    calm: z.boolean().optional(),
    extensionCommands: z.array(z.string().max(64)).max(256).optional(),
    resources: z.array(z.string().min(1).max(128)).max(512).optional(),
    resourceDraft: z.string().max(12000).optional(),
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
    markerPropertyId: z.uuid().optional(),
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
