import { it as check, expect as want } from "vitest";
import DatabaseForSwitch from "better-sqlite3";
import { migrate as migrateForSwitch } from "../src/database.ts";
import { ToolRegistry as Registry } from "../src/tool-registry.ts";
check(
  "a tool is on until the person turns it off, and that is what dispatch asks",
  () => {
    const db = new DatabaseForSwitch(":memory:");
    migrateForSwitch(db);
    const registry = new Registry(db);
    want(registry.enabled("codex")).toBe(true);
    registry.setEnabled("codex", false);
    want(registry.enabled("codex")).toBe(false);
    want(registry.enabled("claude_code")).toBe(true);
    registry.setEnabled("codex", true);
    want(registry.enabled("codex")).toBe(true);
  },
);
