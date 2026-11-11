import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { PluginCatalog } from "../src/plugins.ts";
import { WidgetRegistry } from "../../domain/src/widgets.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  return db;
};
const connector = {
  id: "acme-crm",
  name: "Acme CRM",
  kind: "connector",
  origin: "third_party",
  version: "1.0.0",
  description: "Reads accounts from Acme CRM",
  minAppVersion: "0.1.0",
  permissions: {
    network: ["crm.acme.example"],
    reads: ["accounts"],
    credentials: ["acme-token"],
  },
  connector: { transport: "http", target: "https://crm.acme.example/mcp" },
};

it("installs without granting anything and enables only after the shown permissions are reviewed", () => {
  const db = open();
  const catalog = new PluginCatalog(db, "0.1.0");
  const installed = catalog.install(connector);
  expect(installed).toMatchObject({
    state: "installed",
    granted: false,
    compatible: true,
    added: [],
  });
  expect(installed.permissions).toEqual([
    "Contacts: crm.acme.example",
    "Reads: accounts",
    "Needs credentials: acme-token",
  ]);
  expect(catalog.active("connector")).toEqual([]);
  expect(catalog.mayContact("acme-crm", "crm.acme.example")).toBe(false);
  expect(() =>
    catalog.enable("acme-crm", ["Contacts: somewhere else"]),
  ).toThrow(/Review/);
  expect(catalog.enable("acme-crm", installed.permissions)).toMatchObject({
    state: "enabled",
    granted: true,
  });
  expect(catalog.active("connector").map((m) => m.id)).toEqual(["acme-crm"]);
  expect(catalog.mayContact("acme-crm", "crm.acme.example")).toBe(true);
  expect(catalog.mayContact("acme-crm", "evil.example")).toBe(false);
  expect(catalog.disable("acme-crm").state).toBe("disabled");
  expect(catalog.active("connector")).toEqual([]);
  catalog.remove("acme-crm");
  expect(() => catalog.get("acme-crm")).toThrow(/Unknown/);
  expect(catalog.list()).toEqual([]);
  expect(catalog.install(connector)).toMatchObject({
    state: "installed",
    granted: false,
  });
  db.close();
});

it("keeps a grant across an update with the same access and asks again when access widens", () => {
  const db = open();
  const catalog = new PluginCatalog(db, "0.1.0");
  catalog.enable("acme-crm", catalog.install(connector).permissions);
  expect(() => catalog.install(connector)).toThrow(/newer version/);
  expect(() =>
    catalog.install({
      ...connector,
      version: "1.1.0",
      kind: "policy",
      policy: { rules: [{ name: "x", effect: "deny" }] },
    }),
  ).toThrow(/kind or origin/);
  expect(
    catalog.install({ ...connector, version: "1.1.0", description: "Faster" }),
  ).toMatchObject({ state: "enabled", granted: true, added: [] });
  const wider = catalog.install({
    ...connector,
    version: "1.2.0",
    permissions: { ...connector.permissions, writes: ["accounts"] },
  });
  expect(wider).toMatchObject({
    state: "disabled",
    granted: false,
    added: ["writes: accounts"],
  });
  expect(catalog.active("connector")).toEqual([]);
  expect(() =>
    db.prepare("UPDATE plugins SET state='enabled'").run(),
  ).toThrow();
  db.close();
});

it("refuses invalid, incompatible and overreaching manifests", () => {
  const db = open();
  const catalog = new PluginCatalog(db, "0.1.0");
  expect(() => catalog.install(null)).toThrow(/object/);
  expect(() =>
    catalog.install({ ...connector, id: "Bad Id", version: "one" }),
  ).toThrow(/id must.*version must/);
  expect(() =>
    catalog.install({
      ...connector,
      connector: { transport: "http", target: "https://other.example/mcp" },
    }),
  ).toThrow(/permissions.network omits/);
  expect(() =>
    catalog.install({
      ...connector,
      connector: { transport: "http", target: "http://crm.acme.example" },
    }),
  ).toThrow(/https/);
  expect(() =>
    catalog.install({ ...connector, permissions: { network: ["*.example"] } }),
  ).toThrow(/exact host/);
  expect(() =>
    catalog.install({ ...connector, minAppVersion: "9.0.0" }),
  ).toThrow(/does not support Amun 0.1.0/);
  expect(() =>
    catalog.install({ ...connector, maxAppVersion: "0.1.0" }),
  ).toThrow(/does not support/);
  expect(() =>
    catalog.install({
      id: "tone-guide",
      name: "Tone",
      kind: "skill",
      origin: "customer",
      version: "1.0.0",
      description: "Tone",
      skill: { name: "tone-guide" },
    }),
  ).toThrow(/skills library/);
  db.prepare(
    "INSERT INTO skills(id,name,source_url,version,content_hash) VALUES('s','tone-guide','local','1','h')",
  ).run();
  expect(
    catalog.install({
      id: "tone-guide",
      name: "Tone",
      kind: "skill",
      origin: "customer",
      version: "1.0.0",
      description: "Tone",
      skill: { name: "tone-guide" },
    }).permissions,
  ).toEqual(["Needs no access to your data or network"]);
  expect(() =>
    catalog.install({
      id: "loosen",
      name: "Loosen",
      kind: "policy",
      origin: "customer",
      version: "1.0.0",
      description: "x",
      policy: { rules: [{ name: "merge_pr", effect: "allow" }] },
    }),
  ).toThrow(/only deny or require approval/);
  db.close();
});

it("separates origins, applies the strictest policy, validates workflows and contributes widgets", () => {
  const db = open();
  const catalog = new PluginCatalog(db, "0.1.0");
  const policy = (id: string, effect: string) => ({
    id,
    name: id,
    kind: "policy",
    origin: "customer",
    version: "1.0.0",
    description: "Rule",
    policy: { rules: [{ name: "merge_pr", effect }] },
  });
  for (const manifest of [
    policy("ask-first", "require_approval"),
    policy("freeze", "deny"),
  ]) {
    const p = catalog.install(manifest);
    catalog.enable(manifest.id, p.permissions);
  }
  expect(catalog.policyEffect("merge_pr")).toBe("deny");
  catalog.disable("freeze");
  expect(catalog.policyEffect("merge_pr")).toBe("require_approval");
  expect(catalog.policyEffect("other")).toBeNull();
  const workflow = {
    id: "rfp-response",
    name: "RFP response",
    kind: "workflow",
    origin: "third_party",
    version: "2.0.0",
    description: "Draft an RFP reply",
    workflow: {
      stages: [
        { id: "ingest", title: "Read requirements" },
        {
          id: "draft",
          title: "Draft sections",
          humanCheckpoint: true,
          next: ["review", "ingest"],
        },
        {
          id: "review",
          title: "Compliance check",
          validation: "Every requirement has a response",
        },
      ],
    },
  };
  expect(catalog.install(workflow).state).toBe("installed");
  expect(() =>
    catalog.install({
      ...workflow,
      id: "bad-flow",
      workflow: { stages: [{ id: "a", title: "A", next: ["zzz"] }] },
    }),
  ).toThrow(/unknown stage zzz.*validated/);
  const ui = {
    id: "sales-panel",
    name: "Sales panel",
    kind: "interface",
    origin: "customer",
    version: "1.0.0",
    description: "Deal status",
    interface: { widgets: [{ kind: "sales-panel.deal", slot: "activity" }] },
  };
  expect(() =>
    catalog.install({
      ...ui,
      interface: { widgets: [{ kind: "attention.approve", slot: "island" }] },
    }),
  ).toThrow(/must start with sales-panel\./);
  catalog.enable("sales-panel", catalog.install(ui).permissions);
  const registry = new WidgetRegistry();
  const dispose = catalog.contributeWidgets(registry);
  expect(
    registry.propose({
      id: "w",
      kind: "sales-panel.deal",
      productId: "p",
      data: { title: "Acme renewal" },
    }),
  ).toMatchObject({
    ok: true,
    widget: { title: "Sales panel · Acme renewal", slot: "activity" },
  });
  expect(
    registry.propose({
      id: "x",
      kind: "sales-panel.deal",
      productId: "p",
      data: {},
    }),
  ).toMatchObject({ ok: false, reason: "invalid_data" });
  dispose();
  expect(registry.has("sales-panel.deal")).toBe(false);
  expect(
    catalog
      .list({ origin: "customer" })
      .map((p) => p.manifest.id)
      .sort(),
  ).toEqual(["ask-first", "freeze", "sales-panel"]);
  expect(
    catalog.list({ kind: "workflow" }).map((p) => p.manifest.origin),
  ).toEqual(["third_party"]);
  db.close();
});
