import { describe, expect, it } from "vitest";
import { runAppCommand } from "../src/rebuild/app-commands.ts";

const models = [
  { id: "github-copilot/claude-opus-5.5", label: "Claude Opus 5.5" },
  { id: "github-copilot/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
  { id: "openai-codex/gpt-5", label: "GPT-5" },
];
function deps(extra: { accept?: boolean; none?: boolean } = {}) {
  const chosen: string[] = [];
  const themes: string[] = [];
  return {
    chosen,
    themes,
    deps: {
      themeNames: {
        system: "Match macOS",
        "amun-light": "Amun light",
        "tamer-sabry-default": "Amun dark",
      },
      currentTheme: "system",
      setTheme: (id: string) => void themes.push(id),
      models: async () => (extra.none ? [] : models),
      choose: async (id: string) => {
        chosen.push(id);
        return extra.accept ?? true;
      },
      current: () => "github-copilot/claude-sonnet-5.5",
    },
  };
}

describe("/model", () => {
  it("says which model is in use and how to switch", async () => {
    const { deps: d, chosen } = deps();
    const said = await runAppCommand({ name: "model", argument: "" }, d);
    expect(said).toContain("Claude Sonnet 5.5");
    expect(said).toContain("/model opus");
    expect(chosen).toEqual([]);
  });

  it("switches when the words name one model", async () => {
    const { deps: d, chosen } = deps();
    expect(await runAppCommand({ name: "model", argument: "opus" }, d)).toMatch(
      /^Firstmate now uses \*\*.*Opus 5\.5/,
    );
    expect(chosen).toEqual(["github-copilot/claude-opus-5.5"]);
  });

  it("asks for more when several match, and says so when none does", async () => {
    const { deps: d, chosen } = deps();
    expect(
      await runAppCommand({ name: "model", argument: "claude" }, d),
    ).toMatch(/^Several models match “claude”/);
    expect(
      await runAppCommand({ name: "model", argument: "gemini" }, d),
    ).toMatch(/^No model matches “gemini”/);
    expect(chosen).toEqual([]);
  });

  it("never claims a switch Pi refused, and points to sign-in when there are no models", async () => {
    const refused = deps({ accept: false });
    expect(
      await runAppCommand({ name: "model", argument: "gpt" }, refused.deps),
    ).toMatch(/could not be selected/);
    const empty = deps({ none: true });
    expect(
      await runAppCommand({ name: "model", argument: "" }, empty.deps),
    ).toMatch(/Accounts and models/);
  });
});

describe("/theme", () => {
  it("lists the themes, changes to the one named, and changes nothing otherwise", async () => {
    const { deps: d, themes } = deps();
    expect(await runAppCommand({ name: "theme", argument: "" }, d)).toContain(
      "Match macOS",
    );
    expect(await runAppCommand({ name: "theme", argument: "light" }, d)).toBe(
      "The theme is now **Amun light**.",
    );
    expect(await runAppCommand({ name: "theme", argument: "amun" }, d)).toMatch(
      /^Several themes match/,
    );
    expect(await runAppCommand({ name: "theme", argument: "pink" }, d)).toMatch(
      /^No theme matches/,
    );
    expect(themes).toEqual(["amun-light"]);
  });
});
