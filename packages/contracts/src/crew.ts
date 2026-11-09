import { run } from "./entities.ts";
import { z } from "zod";
const path = z
  .string()
  .min(2)
  .max(4096)
  .regex(/^\//)
  .refine(
    (value) =>
      !/[\0\r\n\t]/.test(value) &&
      !value.split("/").some((part) => part === "." || part === ".."),
  );
export const endpointReceipt = z
  .strictObject({
    version: z.literal(1),
    backend: z.literal("tmux"),
    home: path,
    scope: path,
    socket: path,
    identity: z.strictObject({
      taskId: z.string().regex(/^[-a-zA-Z0-9_]{1,64}$/),
      window: z.string().regex(/^[-a-zA-Z0-9_]+:[-a-zA-Z0-9_@.]+$/),
      worktree: path,
      spawnGeneration: z.string().regex(/^[-a-zA-Z0-9.]{1,128}$/),
      paneId: z.string().regex(/^%[0-9]+$/),
      windowId: z.string().regex(/^@[0-9]+$/),
      serverPid: z.number().int().min(2),
      panePid: z.number().int().min(2),
      ownerToken: z.string().regex(/^[a-f0-9]{32}$/),
    }),
  })
  .refine(
    (value) =>
      value.socket.startsWith(value.scope + "/tmux-") &&
      /^tmux-[0-9]+\/default$/.test(value.socket.slice(value.scope.length + 1)),
  );
export type EndpointReceipt = z.infer<typeof endpointReceipt>;

export const crewObserve = z.strictObject({
  version: z.literal(1),
  kind: z.literal("crew-observe"),
  taskId: z.string().regex(/^[-a-zA-Z0-9_]{1,64}$/),
});
export const crewObservation = z.strictObject({
  version: z.literal(1),
  kind: z.literal("crew-observation"),
  taskId: z.string().regex(/^[-a-zA-Z0-9_]{1,64}$/),
  endpoint: z.enum(["verified", "unknown"]),
  worker: z.literal("unknown"),
  run: run.optional(),
});

export const crewList = z.strictObject({
  version: z.literal(1),
  kind: z.literal("crew-list"),
});
export const crewMember = z.object({
  id: z.string(),
  state: z.string(),
  current: z.string().nullable(),
  endpoint: z.enum(["verified", "unknown"]),
  access: z.string().nullable(),
  decisions: z.array(z.string()),
  next: z.array(z.string()),
  history: z.array(z.string()),
});
export const crewRoster = z.strictObject({
  kind: z.literal("crew-roster"),
  members: z.array(crewMember).nullable(),
});
export const crewInventory = z.strictObject({
  version: z.literal(1),
  kind: z.literal("crew-inventory"),
  tasks: z
    .array(z.string().regex(/^[-a-zA-Z0-9_]{1,64}$/))
    .max(512)
    .nullable(),
});

export const dispatchRequest = z.strictObject({
  harness: z.enum(["codex", "claude"]),
  charter: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((text) =>
      Array.from(text).every(
        (c) => c === "\n" || c === "\t" || c.charCodeAt(0) >= 32,
      ),
    ),
});
export const dispatchScope = z.strictObject({
  scope: z.string().regex(/^\/private\/tmp\/amun-tmux-[A-Za-z0-9]{6}$/),
  token: z.string().regex(/^[a-f0-9]{32}$/),
});
