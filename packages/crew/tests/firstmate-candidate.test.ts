import { expect, it, vi } from "vitest";
import { checkFirstmateCandidate } from "../src/firstmate-candidate.ts";

const commit = "b".repeat(40);
it("reports the exact upstream main and leaves promotion pending", async () => {
  const lookup = vi.fn(async () => commit + "\trefs/heads/main\n");
  expect(await checkFirstmateCandidate("", lookup)).toContain(commit);
  expect(lookup).toHaveBeenCalledTimes(1);
});
it("refuses commands, alternate refs and ambiguous advertisements", async () => {
  const lookup = vi.fn(async () => "");
  await expect(checkFirstmateCandidate("--apply", lookup)).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled();
  for (const output of [
    "",
    commit + "\tHEAD",
    commit + "\trefs/heads/main\nextra",
  ])
    await expect(
      checkFirstmateCandidate("", async () => output),
    ).rejects.toThrow();
});
