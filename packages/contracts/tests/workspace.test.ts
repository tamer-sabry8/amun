import { it, expect } from "vitest";
import {
  workspaceCommand,
  workspaceEvent,
  uiPreferences,
} from "../src/workspace.ts";
it("validates shell commands and rejects raw SQL, arbitrary theme values or invalid resolution sources", () => {
  expect(
    workspaceCommand.safeParse({
      version: 1,
      kind: "workspace",
      action: "snapshot",
    }).success,
  ).toBe(true);
  expect(
    workspaceCommand.safeParse({
      version: 1,
      kind: "workspace",
      action: "sql",
      query: "DROP TABLE products",
    }).success,
  ).toBe(false);
  expect(uiPreferences.safeParse({ theme: "injected" }).success).toBe(false);
  expect(
    workspaceCommand.safeParse({
      version: 1,
      kind: "workspace",
      action: "resolve",
      id: "x",
      source: "automatic",
    }).success,
  ).toBe(false);
  expect(
    workspaceEvent.safeParse({
      version: 1,
      kind: "workspace-search",
      query: "q",
      results: [],
      secret: "token",
    }).success,
  ).toBe(false);
});
