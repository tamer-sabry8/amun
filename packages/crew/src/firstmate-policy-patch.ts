import { createHash } from "node:crypto";
/** Explicit Amun-only compatibility patch; never modifies an installed/personal checkout. */
export function patchFirstmatePermissions(
  source: string,
  expectedSha256: string,
): string {
  if (
    !/^[a-f0-9]{64}$/.test(expectedSha256) ||
    createHash("sha256").update(source).digest("hex") !== expectedSha256
  )
    throw new Error("Firstmate patch source checksum mismatch");
  const anchor = "claude-permission-mode codex-approval-mode";
  if (
    source.split(anchor).length !== 2 ||
    source.includes("codex-permission-mode")
  )
    throw new Error("Firstmate patch anchor mismatch");
  return source.replace(
    anchor,
    "claude-permission-mode codex-permission-mode codex-approval-mode",
  );
}
