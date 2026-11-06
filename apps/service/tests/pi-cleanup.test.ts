import { it, expect } from "vitest";
import { cleanupExtension } from "../src/pi-cleanup.ts";
it("restricts generated cleanup to a private runtime root and safely encodes its path", () => {
  const source = cleanupExtension("/private/tmp/amun-pi-service-abc123");
  expect(source).toContain('"/private/tmp/amun-pi-service-abc123"');
  for (const root of [
    "/Users/personal",
    "/private/tmp",
    "../amun-pi-service-x",
    "/private/tmp/amun-pi-service-../../personal",
    "/private/tmp/amun-pi-service-a\n",
  ])
    expect(() => cleanupExtension(root)).toThrow();
});
