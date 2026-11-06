import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { patchFirstmatePermissions } from "../src/firstmate-policy-patch.ts";
const source =
  'FM_INHERITABLE_CONFIG="${FM_INHERITABLE_CONFIG:-backend claude-permission-mode codex-approval-mode}"\n';
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
it("adds restricted Codex permission propagation while preserving the upstream list", () => {
  expect(patchFirstmatePermissions(source, hash(source))).toBe(
    source.replace(
      "claude-permission-mode codex-approval-mode",
      "claude-permission-mode codex-permission-mode codex-approval-mode",
    ),
  );
});
it("refuses unknown source, missing or repeated anchors and an already patched source", () => {
  expect(() => patchFirstmatePermissions(source, "0".repeat(64))).toThrow();
  for (const text of [
    "missing",
    source + source,
    source.replace(
      "codex-approval-mode",
      "codex-permission-mode codex-approval-mode",
    ),
  ])
    expect(() => patchFirstmatePermissions(text, hash(text))).toThrow();
});
