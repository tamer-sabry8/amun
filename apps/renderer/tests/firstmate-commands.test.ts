import { expect, it } from "vitest";
import {
  composerCommand,
  firstmateCommand,
  firstmateCommands,
} from "../src/composer-command.ts";

it("offers every Firstmate skill the legacy parser accepts", () => {
  for (const { name, description } of firstmateCommands) {
    expect(composerCommand("/" + name)?.name).toBe(name);
    expect(description).not.toMatch(/terminal/i);
  }
});

it("maps skills to the bridge command and argument", () => {
  expect(firstmateCommand("/bearings file include PRs")).toEqual({
    name: "bearings",
    argument: "file include PRs",
  });
  expect(firstmateCommand("/skill:stow")).toEqual({
    name: "stow",
    argument: "",
  });
  expect(firstmateCommand("/updatefirstmate")?.name).toBe("updatefirstmate");
});

it("leaves other commands and messages alone", () => {
  expect(firstmateCommand("/model")).toBeNull();
  expect(firstmateCommand("/mcp github")).toBeNull();
  expect(firstmateCommand("hello /afk")).toBeNull();
});
