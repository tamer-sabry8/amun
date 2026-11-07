import { z } from "zod";
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine(
    (v) =>
      v.split(".").length >= 2 &&
      v
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
  );
export const cloudflareDestination = z
  .strictObject({
    provider: z.literal("cloudflare"),
    zone: hostname,
    host: hostname,
  })
  .refine(
    (v) => v.host === v.zone || v.host.endsWith("." + v.zone),
    "Choose a host inside your zone",
  );
export const hostingDestination = z.union([
  cloudflareDestination,
  z.strictObject({ provider: z.literal("other"), host: hostname }),
]);
export type HostingDestination = z.infer<typeof hostingDestination>;
