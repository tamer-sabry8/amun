import { z } from "zod";
const key = z.string().min(1).max(256);
export const chatTurn = z.strictObject({
  id: z.uuid(),
  productId: key,
  model: key,
  selection: key.nullable(),
  text: z.string().trim().min(1).max(12000),
});
export const chatCommand = z.discriminatedUnion("action", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("firstmate-chat"),
    action: z.enum(["send", "steer", "follow-up"]),
    turn: chatTurn,
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("firstmate-chat"),
    action: z.literal("history"),
    productId: key,
    id: z.uuid(),
  }),
]);
export const chatRecord = z.object({
  id: z.uuid(),
  model: key,
  text: z.string(),
  reply: z.string().nullable(),
  state: z.enum(["working", "answered", "interrupted"]),
});
export const chatResult = z.strictObject({
  kind: z.literal("firstmate-chat-result"),
  productId: key,
  id: z.uuid(),
  phase: z.enum(["history", "stream", "queued", "done", "error"]),
  text: z.string().max(32768),
  history: z.array(chatRecord).optional(),
});
export type ChatTurn = z.infer<typeof chatTurn>;
