import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { piLauncherScript, writePiLauncher } from "../src/pi-launcher.ts";
import {
  chooseCopilotModel,
  CopilotUnavailable,
  selectCopilotModel,
} from "../src/copilot-routing.ts";

const source = {
  binary: "/Applications/Amun.app/Contents/MacOS/Amun",
  entry: "/Applications/Amun.app/Contents/Resources/pi/cli.js",
  authRoot: "/Users/test/Library/Application Support/Amun/pi-agent",
};
describe("Pi launcher", () => {
  it("runs the bundled Pi as Node on Amun credentials with the Copilot provider", () => {
    const text = piLauncherScript(source);
    expect(text).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(text).toContain(
      "export PI_CODING_AGENT_DIR='/Users/test/Library/Application Support/Amun/pi-agent'",
    );
    expect(text).toContain(
      `exec '${source.binary}' '${source.entry}' --provider github-copilot "$@"`,
    );
  });
  it("rejects relative, unnormalized and multi-line paths", () => {
    for (const bad of ["pi", "/a/../b", "/a\nb", "/a\0b"])
      expect(() => piLauncherScript({ ...source, entry: bad })).toThrow(
        "Unsafe Pi entry",
      );
  });
  it("quotes a single quote so a path cannot add shell syntax", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amun-pi-"));
    const marker = join(dir, "marker");
    const entry = join(dir, "x'; touch " + marker + "; '.js");
    const text = piLauncherScript({
      ...source,
      binary: "/usr/bin/true",
      entry,
    });
    const script = join(dir, "run.sh");
    await writeFile(script, text, { mode: 0o700 });
    await promisify(execFile)("/bin/bash", [script]);
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("writes a private executable and refuses an unsafe directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "amun-pi-"));
    const dir = join(root, "launchers");
    await mkdir(dir, { mode: 0o700 });
    const path = await writePiLauncher(dir, source);
    expect((await stat(path)).mode & 0o777).toBe(0o700);
    expect(await readFile(path, "utf8")).toBe(piLauncherScript(source));
    await writePiLauncher(dir, source);
    const open = join(root, "open");
    await mkdir(open, { mode: 0o755 });
    await expect(writePiLauncher(open, source)).rejects.toThrow("Unsafe");
    const link = join(root, "link");
    await symlink(dir, link);
    await expect(writePiLauncher(link, source)).rejects.toThrow("Unsafe");
  });
});
describe("Copilot model choice", () => {
  const models = [
    { provider: "github-copilot", id: "claude-sonnet-5.5" },
    { provider: "github-copilot", id: "gpt-x" },
    { provider: "openai", id: "gpt-x" },
  ];
  it("prefers the saved Copilot model, else the pinned default", () => {
    expect(
      chooseCopilotModel(models, {
        provider: "github-copilot",
        model: "gpt-x",
      }),
    ).toBe(models[1]);
    expect(
      chooseCopilotModel(models, { provider: "openai", model: "gpt-x" }),
    ).toBe(models[0]);
    expect(chooseCopilotModel(models, {})).toBe(models[0]);
  });
  it("fails clearly instead of using another provider", () => {
    expect(() =>
      chooseCopilotModel([models[2]!], { provider: "openai", model: "gpt-x" }),
    ).toThrow("GitHub Copilot is not connected");
  });
});
describe("native session start", () => {
  it("asks the SDK runtime for Copilot models only and uses its saved default", async () => {
    const getAvailable = vi.fn(async () => [
      { provider: "github-copilot", id: "claude-sonnet-5.5" },
      { provider: "github-copilot", id: "gpt-x" },
    ]);
    const model = await selectCopilotModel(
      { getAvailable },
      {
        getDefaultProvider: () => "github-copilot",
        getDefaultModel: () => "gpt-x",
      },
    );
    expect(getAvailable.mock.calls.length).toBe(1);
    expect(model?.id).toBe("gpt-x");
    await expect(
      selectCopilotModel(
        { getAvailable: async () => [] },
        { getDefaultProvider: () => "openai", getDefaultModel: () => "gpt-x" },
      ),
    ).rejects.toThrow("GitHub Copilot is not connected");
    // The renderer holds the message for sign-in only when this reads as a sign-in problem.
    await expect(
      selectCopilotModel(
        { getAvailable: async () => [] },
        {
          getDefaultProvider: () => undefined,
          getDefaultModel: () => undefined,
        },
      ),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof CopilotUnavailable && /sign in/i.test(error.message),
    );
  });
});
