import { it, expect } from "vitest";
import { backupRequest } from "../src/backup-policy.ts";
it("accepts only explicit backup operations and bounded passphrases, never renderer paths", () => {
  expect(
    backupRequest({ action: "export", password: "twelve letters long" }),
  ).toEqual({ action: "export", password: "twelve letters long" });
  for (const value of [
    null,
    { action: "export", password: "short" },
    { action: "delete", password: "twelve letters long" },
    { action: "restore", password: "x".repeat(1025) },
    { action: "restore", password: "twelve letters long", path: "/personal" },
  ])
    expect(backupRequest(value)).toBeNull();
});
