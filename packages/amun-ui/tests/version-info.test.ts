import { describe, expect, it } from "vitest";
import {
  buildDate,
  versionDetails,
  versionLine,
  type BuildInfo,
} from "../src/rebuild/version-info.ts";

const info: BuildInfo = {
  version: "0.9.0",
  displayVersion: "Beta 0.9",
  commit: "abc1234",
  builtAt: "2026-11-15T10:00:00.000Z",
};

describe("version display", () => {
  it("shows the name and number together", () => {
    expect(versionLine(info)).toBe("Version Beta 0.9 (0.9.0)");
  });
  it("copies version, build, macOS and chip", () => {
    expect(
      versionDetails(info, { macos: "26.1", arch: "Apple silicon (arm64)" }),
    ).toBe(
      "Amun Beta 0.9 (0.9.0)\nBuild abc1234, 2026-11-15\nmacOS 26.1\nChip Apple silicon (arm64)",
    );
  });
  it("copes with a missing build date", () => {
    expect(buildDate({ ...info, builtAt: "" })).toBe("unknown");
    expect(buildDate(info)).toContain("2026");
  });
});
