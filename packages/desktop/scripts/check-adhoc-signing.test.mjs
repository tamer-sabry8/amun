import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { describeAdhocRuntimeConflict } = require("./check-adhoc-signing.js");

const details = (flags, signature) =>
  [
    "Executable=/tmp/Amun.app/Contents/MacOS/Amun",
    "Identifier=ai.transfrm.amun",
    `CodeDirectory v=20500 size=433 flags=${flags} hashes=3+7 location=embedded`,
    `Signature=${signature}`,
    "TeamIdentifier=not set",
  ].join("\n");

describe("describeAdhocRuntimeConflict", () => {
  it("rejects an ad-hoc signature with hardened runtime (the PR56 DMG crash)", () => {
    expect(
      describeAdhocRuntimeConflict(details("0x10002(adhoc,runtime)", "adhoc")),
    ).toMatch(/hardened runtime on/);
  });

  it("accepts an ad-hoc beta signature without hardened runtime", () => {
    expect(
      describeAdhocRuntimeConflict(details("0x2(adhoc)", "adhoc")),
    ).toBeNull();
  });

  it("accepts a Developer ID signature with hardened runtime", () => {
    const signed = details("0x10000(runtime)", "size=9000").replace(
      "TeamIdentifier=not set",
      "TeamIdentifier=ABCDE12345",
    );
    expect(describeAdhocRuntimeConflict(signed)).toBeNull();
  });
});
