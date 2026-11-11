import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { Creator } from "../src/creator.ts";
import { PluginCatalog } from "../src/plugins.ts";
import { WidgetRegistry } from "../../domain/src/widgets.ts";
import {
  registerAttentionKinds,
  attentionKindKey,
} from "../../domain/src/attention-widgets.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  return db;
};
const spec = {
  id: "pr-status",
  name: "PR status",
  description: "Shows the state of a pull request",
  widgets: [
    {
      name: "summary",
      slot: "activity",
      fields: [
        { label: "Checks", key: "checks" },
        { label: "Reviews", key: "reviews" },
      ],
    },
  ],
};

it("gives a read-only view of extension surfaces without secrets", () => {
  const db = open();
  const creator = new Creator(db, "0.1.0");
  const registry = new WidgetRegistry();
  registerAttentionKinds(registry);
  new PluginCatalog(db, "0.1.0").install({
    id: "acme-crm",
    name: "Acme",
    kind: "connector",
    origin: "third_party",
    version: "1.0.0",
    description: "CRM",
    permissions: { network: ["crm.example"], credentials: ["acme-token"] },
    connector: { transport: "http", target: "https://crm.example/mcp" },
  });
  const view = creator.introspect(registry, [
    attentionKindKey("approve"),
    "missing.kind",
  ]);
  expect(view.slots).toEqual([
    "island",
    "activity",
    "notifications",
    "inline",
    "toast",
  ]);
  expect(view.widgetKinds).toEqual([
    { kind: "attention.approve", slot: "island", core: true },
  ]);
  expect(view.extensions).toEqual([
    {
      id: "acme-crm",
      name: "Acme",
      kind: "connector",
      origin: "third_party",
      state: "installed",
      userCreated: false,
    },
  ]);
  expect(JSON.stringify(view)).not.toMatch(/acme-token|crm\.example/);
  expect(Object.isFrozen(view)).toBe(true);
  db.close();
});

it("rejects an invalid proposal with every reason, for the agent to correct", () => {
  const db = open();
  const creator = new Creator(db, "0.1.0");
  expect(creator.validate(spec)).toEqual([]);
  expect(creator.validate({ ...spec, widgets: [] })).toEqual([
    "Declare at least one widget or rule",
  ]);
  expect(
    creator.validate({
      ...spec,
      widgets: [
        { name: "Bad Name", slot: "ceiling", fields: [] },
        {
          name: "summary",
          slot: "activity",
          fields: [{ label: " ", key: "a-b" }],
        },
        {
          name: "summary",
          slot: "activity",
          fields: [{ label: "A", key: "a" }],
        },
      ],
      rules: [{ name: "merge_pr", effect: "deny" }],
    }),
  ).toEqual([
    "Put widgets and rules in separate extensions",
    'Widget name "Bad Name" must be short, lower-case letters, digits and hyphens',
    'Widget "Bad Name" uses unknown slot "ceiling"; choose one of island, activity, notifications, inline, toast',
    'Widget "Bad Name" needs 1 to 12 fields',
    'Widget "summary" has a field without a label or with an invalid key',
    'Widget "summary" is declared twice',
  ]);
  expect(creator.validate({ ...spec, id: "Bad Id" })).toEqual([
    "id must be lowercase letters, digits and hyphens",
  ]);
  expect(
    creator.validate({
      id: "loosen",
      name: "L",
      description: "d",
      rules: [{ name: "merge_pr", effect: "allow" as never }],
    }),
  ).toEqual(["a policy can only deny or require approval"]);
  expect(() => creator.build({ ...spec, widgets: [] })).toThrow(
    /Extension rejected/,
  );
  db.close();
});

it("builds, mounts without a restart, isolates a failing widget, and persists across instances", () => {
  const db = open();
  const creator = new Creator(db, "0.1.0");
  const built = creator.build(spec);
  expect(built).toMatchObject({
    state: "enabled",
    granted: true,
    manifest: {
      origin: "customer",
      createdBy: "creator",
      version: "0.0.1",
      kind: "interface",
    },
  });
  const registry = new WidgetRegistry();
  registry.register({
    kind: "clash.panel",
    slot: "activity",
    schema: { safeParse: (i) => ({ success: true, data: i }) },
    title: () => "Taken",
  });
  creator.build({
    id: "clash",
    name: "Clash",
    description: "Collides",
    widgets: [
      { name: "panel", slot: "activity", fields: [{ label: "A", key: "a" }] },
    ],
  });
  const mount = creator.mount(registry);
  expect(mount.mounted).toEqual(["pr-status.summary"]);
  expect(mount.errors).toEqual([
    {
      kind: "clash.panel",
      error: "Widget kind already registered: clash.panel",
    },
  ]);
  expect(
    registry.propose({
      id: "w1",
      kind: "pr-status.summary",
      productId: "p",
      data: { checks: "3 passing", reviews: 1, extra: "dropped" },
    }),
  ).toMatchObject({
    ok: true,
    widget: { title: "PR status", data: { checks: "3 passing", reviews: "1" } },
  });
  expect(
    registry.propose({
      id: "w2",
      kind: "pr-status.summary",
      productId: "p",
      data: { checks: { nested: true } },
    }),
  ).toMatchObject({ ok: false, reason: "invalid_data" });
  mount.dispose();
  expect(registry.has("pr-status.summary")).toBe(false);
  const later = new Creator(db, "0.1.0");
  expect(
    later
      .created()
      .map((p) => p.manifest.id)
      .sort(),
  ).toEqual(["clash", "pr-status"]);
  expect(later.mount(new WidgetRegistry()).mounted.sort()).toEqual([
    "clash.panel",
    "pr-status.summary",
  ]);
  db.close();
});

it("lets a person update, turn off, export and uninstall what was created, and nothing else", () => {
  const db = open();
  const creator = new Creator(db, "0.1.0");
  creator.build(spec);
  expect(
    creator.build({ ...spec, description: "Now with merge state" }).manifest
      .version,
  ).toBe("0.0.2");
  expect(creator.toggle("pr-status", false).state).toBe("disabled");
  expect(creator.mount(new WidgetRegistry()).mounted).toEqual([]);
  expect(creator.toggle("pr-status", true).state).toBe("enabled");
  const exported = JSON.parse(creator.export("pr-status"));
  expect(exported).toMatchObject({
    id: "pr-status",
    createdBy: "creator",
    interface: { widgets: [{ kind: "pr-status.summary", slot: "activity" }] },
  });
  new PluginCatalog(db, "0.1.0").install({
    id: "ask-first",
    name: "Ask",
    kind: "policy",
    origin: "customer",
    version: "1.0.0",
    description: "Rule",
    policy: { rules: [{ name: "merge_pr", effect: "deny" }] },
  });
  expect(() => creator.uninstall("ask-first")).toThrow(
    /not built in Creator Mode/,
  );
  expect(() => creator.build({ ...spec, id: "ask-first" })).toThrow(
    /belongs to an installed extension/,
  );
  creator.uninstall("pr-status");
  expect(creator.created()).toEqual([]);
  expect(() => creator.export("pr-status")).toThrow(/Unknown plugin/);
  const rule = creator.build({
    id: "no-friday-merges",
    name: "No Friday merges",
    description: "Freeze",
    rules: [{ name: "merge_pr", effect: "require_approval" }],
  });
  expect(rule.manifest.kind).toBe("policy");
  expect(new PluginCatalog(db, "0.1.0").policyEffect("merge_pr")).toBe(
    "require_approval",
  );
  db.close();
});
