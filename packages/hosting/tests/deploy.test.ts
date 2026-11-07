import { expect, it, vi } from "vitest";
import { publishOrigin } from "../src/deploy.ts";
import { createHash } from "node:crypto";
const source = "export default {};",
  digest = createHash("sha256").update(source).digest("hex"),
  zoneId = "a".repeat(32),
  accountId = "b".repeat(32);
it("binds approval to source bytes and refuses conflicting DNS or an existing Worker before a write", async () => {
  const call = vi.fn().mockResolvedValue({ accountId, zoneId, clear: false }),
    claim = vi.fn();
  await expect(
    publishOrigin(source, "c".repeat(64), call, claim),
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
  await expect(publishOrigin(source, digest, call, claim)).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
  expect(claim).not.toHaveBeenCalled();
});
it("records the attempt first and never binds the domain after an uncertain upload", async () => {
  const call = vi
      .fn()
      .mockResolvedValueOnce({ accountId, zoneId, clear: true })
      .mockRejectedValueOnce(Error("lost")),
    claim = vi.fn();
  await expect(publishOrigin(source, digest, call, claim)).rejects.toThrow();
  expect(claim).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledTimes(2);
});
