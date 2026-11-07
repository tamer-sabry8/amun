import { expect, it } from "vitest";
import { composerCommand } from "../src/composer-command.ts";
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
