import { expect, it } from "vitest";
import { composerCommand, piModelShortcut } from "../src/composer-command.ts";
it("resolves native slash commands and keeps arguments, without treating unknown input as a model turn", () => {
  expect(composerCommand("  /name Release notes ")).toEqual({
    name: "name",
    argument: "Release notes",
  });
  expect(composerCommand("/tree")).toEqual({ name: "tree", argument: "" });
  for (const input of [
    "/missing",
    "/tree\0",
    "!pwd",
    "just text",
    "/TREE",
    "/tree" + "x".repeat(100),
  ])
    expect(composerCommand(input)).toBeNull();
});
it("routes both Firstmate update spellings to the staged native action", () => {
  for (const name of ["updatefirstmate", "skill:updatefirstmate"]) {
    expect(composerCommand("/" + name)).toEqual({
      name: "updatefirstmate",
      argument: "",
    });
  }
});

it("recognizes Pi's model shortcuts while preserving IME input, repeat and other modifiers", () => {
  const key = {
    key: "l",
    ctrlKey: true,
    shiftKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
  };
  expect(piModelShortcut(key)).toBe("select");
  expect(piModelShortcut({ ...key, key: "p" })).toBe("forward");
  expect(piModelShortcut({ ...key, key: "P", shiftKey: true })).toBe(
    "backward",
  );
  for (const change of [
    { ctrlKey: false },
    { metaKey: true },
    { altKey: true },
    { repeat: true },
    { isComposing: true },
    { shiftKey: true },
    { key: "x" },
  ])
    expect(piModelShortcut({ ...key, ...change })).toBeNull();
});
