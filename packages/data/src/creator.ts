import type Database from "better-sqlite3";
import {
  manifestProblems,
  pluginKinds,
  type PluginManifest,
} from "../../domain/src/plugins.ts";
import {
  widgetSlots,
  type WidgetRegistry,
  type WidgetSlot,
} from "../../domain/src/widgets.ts";
import { PluginCatalog, type InstalledPlugin } from "./plugins.ts";

/**
 * What an agent proposes in Creator Mode. It is a description, not code:
 * widgets are declared as labelled fields, so nothing the agent writes is
 * executed by the app.
 */
export interface ExtensionSpec {
  id: string;
  name: string;
  description: string;
  version?: string;
  widgets?: readonly {
    name: string;
    slot: string;
    fields: readonly { label: string; key: string }[];
  }[];
  /** Rules that restrict the workspace; a creator extension cannot loosen one. */
  rules?: readonly { name: string; effect: "deny" | "require_approval" }[];
}

export interface Introspection {
  /** Places a widget can appear. */
  slots: readonly string[];
  /** Widget kinds already registered, with their slot. */
  widgetKinds: { kind: string; slot: string; core: boolean }[];
  /** Installed extensions. No manifests' credentials or paths are included. */
  extensions: {
    id: string;
    name: string;
    kind: string;
    origin: string;
    state: string;
    userCreated: boolean;
  }[];
  extensionPoints: readonly string[];
  constraints: string[];
}

export const creatorLimits = { widgets: 8, fields: 12, rules: 20 } as const;

export interface MountResult {
  mounted: string[];
  /** Failures, with the reason, for the agent to correct. */
  errors: { kind: string; error: string }[];
  dispose(): void;
}

/**
 * Creator Mode: an agent inspects the extension surfaces, proposes an
 * extension, and the workspace validates, stores and mounts it without a
 * restart. Extensions it builds are ordinary catalog entries marked as
 * user-created, so they can be turned off, exported or removed like any other.
 */
export class Creator {
  private readonly catalog: PluginCatalog;
  constructor(db: Database.Database, appVersion: string) {
    this.catalog = new PluginCatalog(db, appVersion);
  }

  /** A read-only view of what can be extended. It exposes no secrets. */
  introspect(
    registry: WidgetRegistry,
    kinds: readonly string[],
  ): Introspection {
    const extensions = this.catalog.list();
    const created = new Set(
      extensions
        .filter((plugin) => plugin.manifest.createdBy === "creator")
        .map((plugin) => plugin.manifest.id),
    );
    return Object.freeze({
      slots: widgetSlots,
      widgetKinds: kinds
        .filter((kind) => registry.has(kind))
        .map((kind) => ({
          kind,
          slot: registry.kind(kind)!.slot,
          core: ![...created].some((id) => kind.startsWith(id + ".")),
        })),
      extensions: extensions.map((plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        kind: plugin.manifest.kind,
        origin: plugin.manifest.origin,
        state: plugin.state,
        userCreated: created.has(plugin.manifest.id),
      })),
      extensionPoints: pluginKinds,
      constraints: [
        "An extension is declared, not coded: widgets list labelled fields.",
        `At most ${creatorLimits.widgets} widgets and ${creatorLimits.fields} fields per widget.`,
        "Widget kinds are prefixed with the extension id.",
        "A rule can deny or require approval; it cannot allow something.",
        "An extension has no network, credential or file access.",
      ],
    });
  }

  /** Every problem with a proposed extension, for the agent to fix. */
  validate(spec: ExtensionSpec): string[] {
    const problems: string[] = [];
    const widgets = spec.widgets ?? [];
    const rules = spec.rules ?? [];
    if (widgets.length === 0 && rules.length === 0)
      problems.push("Declare at least one widget or rule");
    if (widgets.length > 0 && rules.length > 0)
      problems.push("Put widgets and rules in separate extensions");
    if (widgets.length > creatorLimits.widgets)
      problems.push(`At most ${creatorLimits.widgets} widgets`);
    if (rules.length > creatorLimits.rules)
      problems.push(`At most ${creatorLimits.rules} rules`);
    const names = new Set<string>();
    for (const widget of widgets) {
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(widget.name))
        problems.push(
          `Widget name "${widget.name}" must be short, lower-case letters, digits and hyphens`,
        );
      if (names.has(widget.name))
        problems.push(`Widget "${widget.name}" is declared twice`);
      names.add(widget.name);
      if (!widgetSlots.includes(widget.slot as WidgetSlot))
        problems.push(
          `Widget "${widget.name}" uses unknown slot "${widget.slot}"; choose one of ${widgetSlots.join(", ")}`,
        );
      if (
        widget.fields.length === 0 ||
        widget.fields.length > creatorLimits.fields
      )
        problems.push(
          `Widget "${widget.name}" needs 1 to ${creatorLimits.fields} fields`,
        );
      for (const field of widget.fields)
        if (
          !field.label.trim() ||
          !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field.key)
        )
          problems.push(
            `Widget "${widget.name}" has a field without a label or with an invalid key`,
          );
    }
    if (problems.length === 0)
      problems.push(...manifestProblems(this.manifest(spec)));
    return problems;
  }

  /**
   * Stores the extension and turns it on. A creator extension asks for no
   * access, so there is nothing for the person to grant beyond creating it.
   */
  build(spec: ExtensionSpec): InstalledPlugin {
    const problems = this.validate(spec);
    if (problems.length)
      throw Error("Extension rejected: " + problems.join("; "));
    const existing = this.catalog.list().find((p) => p.manifest.id === spec.id);
    if (existing && existing.manifest.createdBy !== "creator")
      throw Error("That id belongs to an installed extension; choose another");
    const installed = this.catalog.install(this.manifest(spec));
    return this.catalog.enable(spec.id, installed.permissions);
  }

  /** Extensions built in Creator Mode, kept apart from installed ones. */
  created(): InstalledPlugin[] {
    return this.catalog
      .list()
      .filter((plugin) => plugin.manifest.createdBy === "creator");
  }

  toggle(id: string, on: boolean): InstalledPlugin {
    const plugin = this.own(id);
    return on
      ? this.catalog.enable(id, plugin.permissions)
      : this.catalog.disable(id);
  }

  /** The extension as text a person can save, share or re-import. */
  export(id: string): string {
    return JSON.stringify(this.own(id).manifest, null, 2);
  }

  uninstall(id: string): void {
    this.own(id);
    this.catalog.remove(id);
  }

  /**
   * Mounts every enabled creator widget into the registry now. A widget
   * that fails is skipped and reported; the others still mount.
   */
  mount(registry: WidgetRegistry): MountResult {
    const disposers: (() => void)[] = [];
    const mounted: string[] = [];
    const errors: { kind: string; error: string }[] = [];
    for (const plugin of this.created()) {
      if (plugin.state !== "enabled") continue;
      for (const widget of plugin.manifest.interface?.widgets ?? []) {
        try {
          const keys = (widget.fields ?? []).map((field) => field.key);
          disposers.push(
            registry.register({
              kind: widget.kind,
              slot: widget.slot as WidgetSlot,
              schema: {
                safeParse(input) {
                  if (
                    !input ||
                    typeof input !== "object" ||
                    Array.isArray(input)
                  )
                    return {
                      success: false,
                      error: new Error("Widget data must be an object"),
                    };
                  const data: Record<string, string> = {};
                  for (const key of keys) {
                    const value = (input as Record<string, unknown>)[key];
                    if (value === undefined || value === null) continue;
                    if (!["string", "number", "boolean"].includes(typeof value))
                      return {
                        success: false,
                        error: new Error(`${key} must be text or a number`),
                      };
                    data[key] = String(value).slice(0, 500);
                  }
                  return { success: true, data };
                },
              },
              title: () => plugin.manifest.name,
            }),
          );
          mounted.push(widget.kind);
        } catch (error) {
          errors.push({
            kind: widget.kind,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }
    return {
      mounted,
      errors,
      dispose() {
        for (const dispose of disposers.splice(0)) dispose();
      },
    };
  }

  private own(id: string): InstalledPlugin {
    const plugin = this.catalog.get(id);
    if (plugin.manifest.createdBy !== "creator")
      throw Error("That extension was not built in Creator Mode");
    return plugin;
  }

  private manifest(spec: ExtensionSpec): PluginManifest {
    const previous = this.catalog.list().find((p) => p.manifest.id === spec.id);
    const [major, minor, patch] = (previous?.manifest.version ?? "0.0.0")
      .split(".")
      .map(Number) as [number, number, number];
    const widgets = spec.widgets ?? [];
    return {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      origin: "customer",
      createdBy: "creator",
      version: spec.version ?? `${major}.${minor}.${patch + 1}`,
      ...(widgets.length
        ? {
            kind: "interface" as const,
            interface: {
              widgets: widgets.map((widget) => ({
                kind: `${spec.id}.${widget.name}`,
                slot: widget.slot,
                fields: widget.fields.map((f) => ({
                  label: f.label.trim(),
                  key: f.key,
                })),
              })),
            },
          }
        : {
            kind: "policy" as const,
            policy: { rules: [...(spec.rules ?? [])] },
          }),
    };
  }
}
