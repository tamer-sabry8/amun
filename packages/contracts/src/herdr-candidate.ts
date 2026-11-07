import { z } from "zod";
const path = z
  .string()
  .regex(
    /^\/private\/tmp\/amun-firstmate-update-[a-zA-Z0-9]+(?:\/[a-zA-Z0-9_-]+)?$/,
  );
const endpoint = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]+$/);
export const herdrCandidateReceipt = z.strictObject({
  task: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  scope: path,
  home: path,
  worktree: path,
  harness: z.enum(["codex", "claude"]),
  session: z.string().regex(/^fm-lab-amun-[a-z0-9-]{1,48}$/),
  generation: z.string().regex(/^s[0-9.]{1,80}$/),
  pane: endpoint,
  tab: endpoint,
  workspace: endpoint,
  terminal: endpoint,
  socketDevice: z.number().int().nonnegative(),
  socketInode: z.number().int().positive(),
});
export type CandidateReceipt = z.infer<typeof herdrCandidateReceipt>;
