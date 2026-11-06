import { createHash } from "node:crypto";
/** Verify bytes before any distribution code is extracted or executed. */
export function verifyDistributionArchive(
  bytes: Uint8Array,
  digest: string,
): void {
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new Error("Invalid distribution digest");
  if (createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new Error("Distribution integrity mismatch");
}
