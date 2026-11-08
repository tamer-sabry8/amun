import { z } from "zod";
import { attentionItem, notification, statusActivity } from "./entities.ts";
const id = z.string().min(1).max(256);
export const themeName = z.enum([
  "tamer-sabry-default",
  "navy-gold",
  "navy-cyan",
]);
export const uiPreferences = z.strictObject({
  theme: themeName.default("tamer-sabry-default"),
  productId: id.nullable().default(null),
  islandSize: z.enum(["pill", "card", "expanded"]).default("card"),
  pinnedTabs: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1).max(256),
        route: z.string().min(1).max(256),
      }),
    )
    .max(100)
    .default([]),
});
const base = { version: z.literal(1), kind: z.literal("workspace") };
export const workspaceCommand = z.discriminatedUnion("action", [
  z.strictObject({ ...base, action: z.literal("snapshot") }),
  z.strictObject({
    ...base,
    action: z.literal("preferences"),
    preferences: uiPreferences,
  }),
  z.strictObject({
    ...base,
    action: z.literal("snooze"),
    id,
    until: z.iso.datetime(),
  }),
  z.strictObject({
    ...base,
    action: z.literal("resolve"),
    id,
    source: z.enum(["island", "review"]),
    answer: z.string().max(16384).optional(),
  }),
  z.strictObject({
    ...base,
    action: z.literal("search"),
    productId: id.nullable(),
    query: z.string().max(512),
  }),
]);
export const workspaceSnapshot = z.strictObject({
  version: z.literal(1),
  kind: z.literal("workspace-snapshot"),
  preferences: uiPreferences,
  products: z
    .array(z.strictObject({ id, name: z.string().min(1).max(4096) }))
    .max(1000),
  attention: z.array(attentionItem).max(10000),
  activities: z.array(statusActivity).max(10000),
  notifications: z.array(notification).max(10000),
  artifacts: z
    .array(
      z.strictObject({
        id,
        productId: id,
        kind: z.string().max(128),
        ref: z.string().max(4096),
      }),
    )
    .max(10000),
  skills: z
    .array(
      z.strictObject({
        id,
        name: z.string().max(256),
        version: z.string().max(128),
        approvedAt: z.string().nullable(),
      }),
    )
    .max(1000),
});
export const workspaceEvent = z.discriminatedUnion("kind", [
  workspaceSnapshot,
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("workspace-search"),
    query: z.string().max(512),
    results: z
      .array(
        z.strictObject({
          id,
          kind: z.string().max(128),
          title: z.string().max(4096),
        }),
      )
      .max(50),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("workspace-error"),
    message: z.string().max(1024),
  }),
]);
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshot>;
export type WorkspaceEvent = z.infer<typeof workspaceEvent>;
export type UiPreferences = z.infer<typeof uiPreferences>;
