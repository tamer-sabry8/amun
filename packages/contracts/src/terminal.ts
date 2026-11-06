import { z } from "zod";
const base = { version: z.literal(1), kind: z.literal("terminal") };
export const terminalCommand = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.enum(["open", "close", "take-control", "release-control"]),
  }),
  z.strictObject({
    ...base,
    action: z.literal("input"),
    data: z.string().min(1).max(4096),
  }),
  z.strictObject({
    ...base,
    action: z.literal("resize"),
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(200),
  }),
]);
export const terminalEvent = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("terminal-state"),
    state: z.enum(["readonly", "control", "closed", "unavailable"]),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("terminal-data"),
    data: z.string().max(65536),
  }),
]);
export type TerminalEvent = z.infer<typeof terminalEvent>;

export const backendTerminalOpen = z.strictObject({
  ...base,
  action: z.literal("attach-backend"),
  taskId: z.string().regex(/^[-a-zA-Z0-9_]{1,64}$/),
});
