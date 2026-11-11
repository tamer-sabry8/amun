import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { PortLeases } from "../src/port-leases.ts";
import { ToolRegistry } from "../src/tool-registry.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  return db;
};
const task = (id: string) => ({ kind: "work_item", id });

it("gives ten parallel tasks ten different ports and reuses a released one", () => {
  const db = open();
  const ports = new PortLeases(db, { first: 4100, last: 4110 });
  const leased = Array.from(
    { length: 10 },
    (_, i) => ports.lease(task("T" + i)).port,
  );
  expect(leased).toEqual([
    4100, 4101, 4102, 4103, 4104, 4105, 4106, 4107, 4108, 4109,
  ]);
  expect(ports.lease(task("T3")).port).toBe(4103);
  expect(ports.release(task("T3"))).toBe(4103);
  expect(ports.release(task("T3"))).toBeNull();
  expect(ports.forTask(task("T3"))).toBeNull();
  expect(ports.lease(task("new")).port).toBe(4103);
  expect(ports.lease(task("last")).port).toBe(4110);
  expect(() => ports.lease(task("overflow"))).toThrow(
    /No free port between 4100 and 4110/,
  );
  expect(ports.leases()).toHaveLength(11);
  expect(() =>
    db.prepare("INSERT INTO port_leases VALUES (4100,'x','y','now')").run(),
  ).toThrow();
  db.close();
});

it("skips ports another program holds and refuses a bad range", () => {
  const db = open();
  const ports = new PortLeases(db, { first: 4100, last: 4105 });
  expect(ports.lease(task("a"), (port) => port < 4103).port).toBe(4103);
  expect(() => new PortLeases(db, { first: 80, last: 90 })).toThrow();
  expect(() => new PortLeases(db, { first: 5000, last: 4000 })).toThrow();
  expect(() => ports.lease({ kind: " ", id: "x" })).toThrow();
  db.close();
});

it("keeps a person's choices about tools and lets them add, disable and remove one", () => {
  const db = open();
  const tools = new ToolRegistry(db);
  const probes = {
    claude_code: {
      found: true,
      versionText: "2.1.321",
      path: "/usr/local/bin/claude",
    },
    codex: { found: true, versionText: "0.163.0" },
    my_agent: {
      found: true,
      versionText: "my-agent 1.2",
      path: "/opt/my-agent",
    },
  };
  const status = () =>
    Object.fromEntries(
      tools
        .report(probes)
        .map((r) => [r.id, [r.status, r.isDefault, r.origin]]),
    );
  expect(status().claude_code).toEqual(["ready", false, "detected"]);
  expect(status().tmux).toEqual(["not_installed", false, "detected"]);
  tools.setDefault("codex");
  tools.setDefault("claude_code");
  expect(status()).toMatchObject({
    claude_code: ["ready", true, "detected"],
    codex: ["ready", false, "detected"],
  });
  tools.setEnabled("claude_code", false);
  expect(status().claude_code).toEqual(["disabled", false, "detected"]);
  expect(() => tools.setDefault("claude_code")).toThrow(/Turn the tool on/);
  tools.remove("claude_code");
  expect(status().claude_code).toEqual(["ready", false, "detected"]);
  tools.addManual("my_agent", "My agent", "/opt/my-agent");
  expect(status().my_agent).toEqual(["ready", false, "manual"]);
  expect(tools.tools().find((t) => t.id === "my_agent")).toMatchObject({
    explicitPath: "/opt/my-agent",
    versionArgs: ["--version"],
  });
  expect(() => tools.addManual("codex", "Dup", "/x")).toThrow(/new name/);
  expect(() => tools.addManual("rel", "Rel", "bin/tool")).toThrow(
    /absolute path/,
  );
  expect(() => tools.addManual("dots", "Dots", "/opt/../etc/passwd")).toThrow(
    /absolute path/,
  );
  expect(() => tools.setEnabled("ghost", true)).toThrow(/Unknown tool/);
  tools.remove("my_agent");
  expect(status().my_agent).toBeUndefined();
  db.close();
});
