import { expect, it } from "vitest";
import {
  cloudflareConsentArgs,
  cloudflareZoneCode,
} from "../src/cloudflare-hosting.ts";
it("opens only the Cloudflare Code Mode consent page in Edge", () => {
  expect(
    cloudflareConsentArgs("https://mcp.cloudflare.com/authorize?state=fixture"),
  ).toEqual([
    "-a",
    "Microsoft Edge",
    "https://mcp.cloudflare.com/authorize?state=fixture",
  ]);
  for (const u of [
    "https://mcp.cloudflare.com.example/authorize",
    "https://user@mcp.cloudflare.com/authorize",
    "https://mcp.cloudflare.com/token",
  ])
    expect(() => cloudflareConsentArgs(u)).toThrow();
});
it("limits the hosting preflight to reading the named zone and host", () => {
  expect(cloudflareZoneCode("example.org", "mine.example.org")).toContain(
    "example.org",
  );
  expect(cloudflareZoneCode("example.org", "mine.example.org")).toContain(
    "mine.example.org",
  );
  expect(cloudflareZoneCode("example.org", "mine.example.org")).not.toMatch(
    /POST|PATCH|DELETE|PUT/,
  );
});
