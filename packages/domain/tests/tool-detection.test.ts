import { it, expect } from "vitest";
import {
  classifyTool,
  extractVersion,
  knownTools,
  summarizeTools,
} from "../src/tool-detection.ts";

const tool = (id: string) => knownTools.find((t) => t.id === id)!;

it("reads a version from varied output", () => {
  expect(extractVersion("2.1.321 (Claude Code)")).toBe("2.1.321");
  expect(extractVersion("tmux 3.8")).toBe("3.8.0");
  expect(extractVersion("git version 2.43.0")).toBe("2.43.0");
  expect(extractVersion("codex-cli 0.163.0-beta")).toBe("0.163.0");
  expect(extractVersion("no numbers")).toBeNull();
  expect(extractVersion(undefined)).toBeNull();
});

it("tells apart ready, sign-in, missing, outdated, blocked and turned off, with one next step each", () => {
  const status = (id: string, probe: object, setting?: object) => {
    const r = classifyTool(tool(id), probe as never, setting as never);
    return [r.status, r.nextAction];
  };
  expect(
    status("claude_code", {
      found: true,
      path: "/bin/claude",
      versionText: "2.1.321",
      signedIn: true,
    }),
  ).toEqual(["ready", "Choose it as the default, or leave as is"]);
  expect(
    status("claude_code", {
      found: true,
      versionText: "2.1.321",
      signedIn: false,
    }),
  ).toEqual(["needs_sign_in", "Sign in: claude auth login"]);
  expect(status("codex", { found: false })).toEqual([
    "not_installed",
    "Install the Codex CLI from OpenAI, or skip",
  ]);
  expect(status("tmux", { found: true, versionText: "tmux 2.9" })).toEqual([
    "outdated",
    "Update to 3.0.0 or newer",
  ]);
  expect(status("tmux", { found: true, versionText: "tmux 3.0" })[0]).toBe(
    "ready",
  );
  expect(status("git", { found: true, denied: true })).toEqual([
    "blocked",
    "Allow Amun to run it in macOS Privacy & Security, then refresh",
  ]);
  expect(status("git", { found: true, versionText: "garbled" })[0]).toBe(
    "blocked",
  );
  expect(
    status(
      "codex",
      { found: true, versionText: "1.0.0" },
      { enabled: false, isDefault: true, origin: "detected" },
    ),
  ).toEqual(["disabled", "Turn it on to use it"]);
  const chosen = classifyTool(
    tool("codex"),
    { found: true, versionText: "1.0.0" },
    { enabled: true, isDefault: true, origin: "detected" },
  );
  expect(chosen).toMatchObject({
    isDefault: true,
    nextAction: "Nothing to do",
    lifecycleEvents: true,
  });
  expect(
    classifyTool(
      tool("codex"),
      { found: false },
      { enabled: true, isDefault: true, origin: "detected" },
    ).isDefault,
  ).toBe(false);
});

it("says what each tool can reach and never includes a credential field", () => {
  for (const known of knownTools) {
    expect(known.access).not.toBe("");
    expect(known.dataShared).not.toBe("");
    expect(known.versionArgs.every((arg) => /^--?[A-Za-z]+$/.test(arg))).toBe(
      true,
    );
  }
  const report = classifyTool(tool("claude_code"), {
    found: true,
    versionText: "2.0.0",
  });
  expect(
    Object.keys(report).some((key) => /token|secret|credential/i.test(key)),
  ).toBe(false);
  expect(
    summarizeTools([
      report,
      classifyTool(tool("codex"), { found: false }),
      classifyTool(tool("tmux"), { found: true, versionText: "1.0" }),
    ]),
  ).toBe("1 ready · 1 need attention · 1 not installed");
});
