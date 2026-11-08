import { z } from "zod";
export const stowFiles = [
  "captain.md",
  "captain-shared.md",
  "learnings.md",
] as const;
const classification = z.strictObject({
  file: z.enum([...stowFiles, "skip"]),
  replace: z.int().min(-1),
});
export function classificationSchema(count: number) {
  const labels = Object.fromEntries(
    Array.from({ length: count }, (_, i) => ["s" + i, classification]),
  );
  const schema = z.strictObject(labels);
  return { schema, grammar: JSON.stringify(z.toJSONSchema(schema)) };
}
const edit = z.strictObject({
  file: z.enum(stowFiles),
  previous: z.string().max(65536),
  text: z.string().min(1).max(1200),
});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const stowState = z.strictObject({
  seen: z.string(),
  pins: z.array(z.strictObject({ id: hash, edit })),
  settled: z.array(hash),
});

export const stowMessage = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(262144),
});
export type StowMessage = z.infer<typeof stowMessage>;
