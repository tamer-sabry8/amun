import { z } from "zod";
import { bridgeTools } from "../../pi-bridge/src/gate.ts";

const requestSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("event"),
    name: z.enum([
      "bridge_ready",
      "agent_start",
      "agent_settled",
      "mcp_replaced",
    ]),
  }),
  z.strictObject({
    op: z.literal("gate"),
    name: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/),
    nested: z.boolean(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    op: z.literal("tool"),
    name: z.enum(
      Object.keys(bridgeTools) as [
        keyof typeof bridgeTools,
        ...(keyof typeof bridgeTools)[],
      ],
    ),
    summary: z.string().max(1024),
  }),
]);
export type BridgeRequest = z.infer<typeof requestSchema>;

export const bridgeFrame = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  request: requestSchema,
});
