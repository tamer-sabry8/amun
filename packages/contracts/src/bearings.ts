import { z } from "zod";
const rows = z.array(z.record(z.string(), z.unknown())).max(2048);
export const bearingsSnapshot = z.object({
  schema: z.literal("fm-bearings.v1"),
  generated: z.iso.datetime(),
  prs: z.string(),
  contributions: z.object({
    captain: rows,
    known: z.number(),
    checked: z.number(),
    proven_clear: z.boolean(),
  }),
  decisions_open: rows,
  landed: rows,
  secondmates: rows,
  in_flight: rows,
  gates: rows,
  candidate_prs: rows.optional(),
  unhealthy_endpoints: rows.optional(),
});
