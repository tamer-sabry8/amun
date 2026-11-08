import { z } from "zod";
const reply = z.object({
  isError: z.literal(false).optional(),
  content: z.array(z.unknown()).max(16),
});
const file = z.object({
  type: z.literal("resource"),
  resource: z.object({
    uri: z.string().regex(/^repo:\/\/tamer-sabry8\/amun\/[^?#]*package\.json$/),
    text: z.string().max(131072),
  }),
});
export function verifyAmunManifest(input: unknown): boolean {
  const result = reply.safeParse(input);
  return (
    result.success &&
    result.data.content.some((part) => {
      const item = file.safeParse(part);
      if (!item.success) return false;
      try {
        const manifest = JSON.parse(item.data.resource.text);
        return (
          manifest?.name === "amun" &&
          typeof manifest.packageManager === "string" &&
          manifest.packageManager.startsWith("pnpm@")
        );
      } catch {
        return false;
      }
    })
  );
}
