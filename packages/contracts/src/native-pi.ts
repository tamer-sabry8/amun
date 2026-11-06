import { z } from "zod";
const base = { version: z.literal(1), kind: z.literal("native-pi") };
const id = z.string().min(1).max(128);
export const nativePiCommand = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.literal("run"),
    id,
    command: z.string().regex(/^[a-z][a-z-]{0,63}$/),
    argument: z.string().max(16384),
  }),
  z.strictObject({ ...base, action: z.literal("close") }),
]);
export const nativePiResult = z.discriminatedUnion("kind", [
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
