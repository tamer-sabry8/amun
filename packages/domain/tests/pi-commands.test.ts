import { it, expect, vi } from "vitest";
import {
  builtinPiCommands,
  commandCatalog,
  routePiInput,
} from "../src/pi-commands.ts";
it("routes every built-in to an explicit native action, never as a model prompt", async () => {
  const native = vi.fn(async () => undefined),
    prompt = vi.fn(async () => undefined);
  for (const command of builtinPiCommands) {
    await routePiInput("/" + command.name, [], { native, prompt });
    expect(native).toHaveBeenLastCalledWith(command.name, "");
  }
  expect(prompt).not.toHaveBeenCalled();
});
it("uses only loaded resource commands, strips source paths and reserves built-in names", async () => {
  const resources = [
    {
      name: "skill:afk",
      description: "Away",
      source: "skill",
      sourceInfo: { path: "/private/config" },
    },
    { name: "settings", source: "extension" },
  ];
  const catalog = commandCatalog(resources);
  expect(JSON.stringify(catalog)).not.toContain("/private");
  expect(catalog.filter((c) => c.name === "settings")).toHaveLength(1);
  const native = vi.fn(async () => undefined),
    prompt = vi.fn(async () => undefined);
  await routePiInput("/skill:afk now", resources, { native, prompt });
  expect(prompt).toHaveBeenCalledWith("/skill:afk now");
  await expect(
    routePiInput("/missing", resources, { native, prompt }),
  ).rejects.toThrow();
});
it("bounds input and discovery, preserves arguments without shell parsing and rejects malformed records", async () => {
  const native = vi.fn(async () => undefined),
    prompt = vi.fn(async () => undefined);
  await routePiInput('/compact keep "decisions"', [], { native, prompt });
  expect(native).toHaveBeenCalledWith("compact", 'keep "decisions"');
  await routePiInput("ordinary message", [], { native, prompt });
  expect(prompt).toHaveBeenCalledWith("ordinary message");
  await routePiInput("!git status", [], { native, prompt });
  expect(native).toHaveBeenLastCalledWith("shell-context", "git status");
  await routePiInput("!!pwd", [], { native, prompt });
  expect(native).toHaveBeenLastCalledWith("shell-private", "pwd");
  for (const value of ["", "/", "x".repeat(16385), "hello\u0000"])
    await expect(routePiInput(value, [], { native, prompt })).rejects.toThrow();
  for (const value of [
    null,
    {},
    Array(513).fill({}),
    [{ name: "../bad", source: "skill" }],
    [{ name: "x", source: "shell" }],
  ])
    expect(() => commandCatalog(value)).toThrow();
});
it("reserves the staged updater even when upstream supplies an update skill", async () => {
  const actions = {
    native: vi.fn(async () => undefined),
    prompt: vi.fn(async () => undefined),
  };
  for (const name of ["updatefirstmate", "skill:updatefirstmate"])
    await routePiInput("/" + name, [{ name, source: "skill" }], actions);
  expect(actions.native.mock.calls).toEqual([
    ["updatefirstmate", ""],
    ["updatefirstmate", ""],
  ]);
  expect(actions.prompt).not.toHaveBeenCalled();
});
