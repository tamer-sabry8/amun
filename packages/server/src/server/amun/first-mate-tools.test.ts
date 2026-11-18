import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { isPaseoToolEnabled } from "../agent/paseo-tool-policy.js";
import {
  FIRST_MATE_BLOCKED_TOOLS,
  FIRST_MATE_KEPT_TOOLS,
  paseoToolPolicyFor,
} from "./first-mate-tools.js";

const registered = (): string[] => {
  const source = readFileSync(
    fileURLToPath(new URL("../agent/tools/paseo-tools.ts", import.meta.url)),
    "utf8",
  );
  return [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((match) => match[1]!);
};

describe("First Mate Paseo tools", () => {
  test("every built-in Paseo tool is either kept or blocked for the First Mate", () => {
    // A new upstream tool fails here until someone decides which list it joins.
    const decided = new Set<string>([...FIRST_MATE_KEPT_TOOLS, ...FIRST_MATE_BLOCKED_TOOLS]);
    const tools = registered();
    expect(tools.length).toBeGreaterThan(30);
    expect(tools.filter((name) => !decided.has(name))).toEqual([]);
  });

  test("the First Mate keeps read-only tools and heartbeats, nothing that starts crew", () => {
    const policy = paseoToolPolicyFor("/fm", "/fm/", { disabledTools: ["speak_extra"] });
    for (const name of FIRST_MATE_KEPT_TOOLS) expect(isPaseoToolEnabled(policy, name)).toBe(true);
    for (const name of FIRST_MATE_BLOCKED_TOOLS)
      expect(isPaseoToolEnabled(policy, name)).toBe(false);
    expect(policy?.disabledTools).toContain("speak_extra");
    // Plugin tools such as the browser are not named here, so they stay on.
    expect(isPaseoToolEnabled(policy, "browser_open")).toBe(true);
  });

  test("other agents keep the provider's own policy", () => {
    const base = { enabled: true };
    expect(paseoToolPolicyFor("/fm", "/work/repo", base)).toBe(base);
    expect(paseoToolPolicyFor(null, "/fm", base)).toBe(base);
  });
});
