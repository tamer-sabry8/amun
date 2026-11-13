import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeTool, searchFolders } from "../src/tool-probe.ts";
import {
  classifyTool,
  knownTools,
} from "../../../packages/domain/src/tool-detection.ts";

const tool = knownTools.find((item) => item.id === "codex")!;
function folderWith(name: string, mode = 0o755) {
  const folder = mkdtempSync(join(tmpdir(), "amun-probe-"));
  writeFileSync(join(folder, name), "#!/bin/sh\n");
  chmodSync(join(folder, name), mode);
  return folder;
}

describe("looking for agent tools on this Mac", () => {
  it("finds a tool and runs only its fixed version command", async () => {
    const folder = folderWith("codex");
    const calls: [string, readonly string[]][] = [];
    const result = await probeTool(tool, [folder], async (file, args) => {
      calls.push([file, args]);
      return { stdout: "codex-cli 0.48.1\n" };
    });
    expect(calls).toEqual([[join(folder, "codex"), ["--version"]]]);
    expect(classifyTool(tool, result)).toMatchObject({
      status: "ready",
      version: "0.48.1",
      path: join(folder, "codex"),
    });
  });
  it("reports a tool that is not there without running anything", async () => {
    const result = await probeTool(
      tool,
      [mkdtempSync(join(tmpdir(), "e-"))],
      () => {
        throw Error("must not run");
      },
    );
    expect(classifyTool(tool, result).status).toBe("not_installed");
  });
  it("ignores a file that cannot be run", async () => {
    const folder = folderWith("codex", 0o644);
    const result = await probeTool(tool, [folder], () => {
      throw Error("must not run");
    });
    expect(result.found).toBe(false);
  });
  it("separates blocked from outdated", async () => {
    const folder = folderWith("git");
    const git = knownTools.find((item) => item.id === "git")!;
    const denied = await probeTool(git, [folder], async () => ({
      stdout: "",
      denied: true,
    }));
    expect(classifyTool(git, denied).status).toBe("blocked");
    const old = await probeTool(git, [folder], async () => ({
      stdout: "git version 2.20.1",
    }));
    expect(classifyTool(git, old).status).toBe("outdated");
  });
  it("uses a manual tool's own path and nothing else", async () => {
    const folder = folderWith("mytool");
    const result = await probeTool(
      {
        ...tool,
        id: "mytool",
        command: "mytool",
        explicitPath: join(folder, "mytool"),
      },
      ["/nonexistent"],
      async () => ({ stdout: "1.2.3" }),
    );
    expect(result).toMatchObject({ found: true, path: join(folder, "mytool") });
  });
  it("searches known install folders before the PATH, once each", async () => {
    const folders = await searchFolders(
      "/Users/someone",
      "/opt/homebrew/bin:relative:/custom/bin",
    );
    expect(folders[0]).toBe("/Users/someone/.local/bin");
    expect(folders).toContain("/custom/bin");
    expect(folders).not.toContain("relative");
    expect(new Set(folders).size).toBe(folders.length);
  });
});
