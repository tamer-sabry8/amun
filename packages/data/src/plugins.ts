import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  addedPermissions,
  compatible,
  compareVersions,
  describePermissions,
  manifestProblems,
  normalizePermissions,
  type PluginKind,
  type PluginManifest,
  type PluginOrigin,
} from "../../domain/src/plugins.ts";
import type { WidgetRegistry } from "../../domain/src/widgets.ts";

export type PluginState = "installed" | "enabled" | "disabled" | "removed";

export interface InstalledPlugin {
  manifest: PluginManifest;
  state: PluginState;
  /** True when a person granted exactly the access this version asks for. */
  granted: boolean;
  compatible: boolean;
  permissions: string[];
}

interface Row {
  id: string;
  manifest_json: string;
  manifest_hash: string;
  granted_hash: string | null;
  state: PluginState;
}

function grantHash(manifest: PluginManifest): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        manifest.id,
        manifest.kind,
        normalizePermissions(manifest.permissions),
        manifest.provider ?? null,
        manifest.connector ?? null,
        manifest.policy ?? null,
      ]),
    )
    .digest("hex");
}

/**
 * The catalog of installed extensions. Installing stores a manifest and
 * grants nothing. A plugin runs only after a person grants the access its
 * manifest asks for; an update that asks for more must be granted again.
 */
export class PluginCatalog {
  private readonly db: Database.Database;
  private readonly appVersion: string;
  constructor(db: Database.Database, appVersion: string) {
    this.db = db;
    this.appVersion = appVersion;
  }

  /** Adds a plugin, or a newer version of one, without enabling it. */
  install(input: unknown): InstalledPlugin & { added: string[] } {
    const problems = manifestProblems(input);
    if (problems.length > 0)
      throw Error("Invalid plugin manifest: " + problems.join("; "));
    const manifest = input as PluginManifest;
    if (!compatible(manifest, this.appVersion))
      throw Error(`${manifest.name} does not support Amun ${this.appVersion}`);
    if (manifest.kind === "skill" && !this.skillExists(manifest.skill!.name))
      throw Error("Review the skill in the skills library before packaging it");
    return this.db
      .transaction(() => {
        const existing = this.row(manifest.id);
        const previous =
          existing && existing.state !== "removed"
            ? (JSON.parse(existing.manifest_json) as PluginManifest)
            : null;
        if (previous) {
          if (
            previous.kind !== manifest.kind ||
            previous.origin !== manifest.origin
          )
            throw Error("An update cannot change a plugin's kind or origin");
          if (compareVersions(manifest.version, previous.version) <= 0)
            throw Error("An update must have a newer version");
        }
        const hash = grantHash(manifest);
        // The earlier grant carries over only when the access is unchanged.
        const keepsGrant = previous !== null && existing!.granted_hash === hash;
        const now = new Date().toISOString();
        this.db
          .prepare(
            `INSERT INTO plugins(id,name,kind,origin,version,manifest_json,manifest_hash,granted_hash,state,installed_at,updated_at)
             VALUES (@id,@name,@kind,@origin,@version,@json,@hash,@granted,@state,@now,@now)
             ON CONFLICT(id) DO UPDATE SET name=@name,kind=@kind,origin=@origin,version=@version,manifest_json=@json,
               manifest_hash=@hash,granted_hash=@granted,state=@state,updated_at=@now`,
          )
          .run({
            id: manifest.id,
            name: manifest.name,
            kind: manifest.kind,
            origin: manifest.origin,
            version: manifest.version,
            json: JSON.stringify(manifest),
            hash,
            granted: keepsGrant ? hash : null,
            state:
              keepsGrant && existing!.state === "enabled"
                ? "enabled"
                : previous
                  ? "disabled"
                  : "installed",
            now,
          });
        return {
          ...this.get(manifest.id),
          added: previous ? addedPermissions(previous, manifest) : [],
        };
      })
      .immediate();
  }

  get(id: string): InstalledPlugin {
    const row = this.row(id);
    if (!row || row.state === "removed") throw Error("Unknown plugin");
    return this.toPlugin(row);
  }

  /** Installed plugins, optionally of one kind or origin. */
  list(
    filter: { kind?: PluginKind; origin?: PluginOrigin } = {},
  ): InstalledPlugin[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM plugins WHERE state<>'removed' ORDER BY origin,name,id",
      )
      .all() as Row[];
    return rows
      .map((row) => this.toPlugin(row))
      .filter(
        (plugin) =>
          (!filter.kind || plugin.manifest.kind === filter.kind) &&
          (!filter.origin || plugin.manifest.origin === filter.origin),
      );
  }

  /**
   * Grants the access the current manifest asks for and turns the plugin on.
   * `reviewed` must be the permission lines the person was shown, so a
   * manifest that changed after review is not enabled.
   */
  enable(id: string, reviewed: readonly string[]): InstalledPlugin {
    const plugin = this.get(id);
    if (!plugin.compatible)
      throw Error(
        `${plugin.manifest.name} does not support Amun ${this.appVersion}`,
      );
    if (JSON.stringify(reviewed) !== JSON.stringify(plugin.permissions))
      throw Error("Review the plugin's current permissions before enabling it");
    this.db
      .prepare(
        "UPDATE plugins SET state='enabled',granted_hash=manifest_hash,updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), id);
    return this.get(id);
  }

  /** Turns a plugin off. Its grant is kept so it can be turned on again. */
  disable(id: string): InstalledPlugin {
    this.get(id);
    this.db
      .prepare("UPDATE plugins SET state='disabled',updated_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
    return this.get(id);
  }

  /** Removes a plugin and its grant. Reinstalling starts from nothing. */
  remove(id: string): void {
    this.get(id);
    this.db
      .prepare(
        "UPDATE plugins SET state='removed',granted_hash=NULL,updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), id);
  }

  /** Enabled plugins of one kind: what the runtime may actually use. */
  active(kind: PluginKind): PluginManifest[] {
    return this.list({ kind })
      .filter((plugin) => plugin.state === "enabled" && plugin.granted)
      .map((plugin) => plugin.manifest);
  }

  /** True when an enabled plugin may contact this host. */
  mayContact(id: string, host: string): boolean {
    const plugin = this.get(id);
    return (
      plugin.state === "enabled" &&
      normalizePermissions(plugin.manifest.permissions).network.includes(host)
    );
  }

  /** The strictest effect enabled policy plugins give a named rule. */
  policyEffect(rule: string): "deny" | "require_approval" | null {
    const effects = this.active("policy").flatMap((manifest) =>
      (manifest.policy?.rules ?? [])
        .filter((candidate) => candidate.name === rule)
        .map((candidate) => candidate.effect),
    );
    return effects.includes("deny")
      ? "deny"
      : effects.includes("require_approval")
        ? "require_approval"
        : null;
  }

  /**
   * Registers the widget kinds of enabled interface plugins. Returns one
   * disposer that removes them, for when a plugin is disabled or removed.
   */
  contributeWidgets(registry: WidgetRegistry): () => void {
    const disposers = this.active("interface").flatMap((manifest) =>
      (manifest.interface?.widgets ?? [])
        .filter((widget) => !registry.has(widget.kind))
        .map((widget) =>
          registry.register({
            kind: widget.kind,
            slot: widget.slot as "island",
            // Plugin widgets carry display text only.
            schema: {
              safeParse: (input) =>
                input &&
                typeof input === "object" &&
                typeof (input as { title?: unknown }).title === "string"
                  ? { success: true, data: input as { title: string } }
                  : { success: false, error: new Error("title required") },
            },
            title: (data) => manifest.name + " · " + data.title,
            actions: [{ id: "open", label: "Open", primary: true }],
          }),
        ),
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  }

  private skillExists(name: string): boolean {
    return (
      this.db.prepare("SELECT 1 FROM skills WHERE name=? LIMIT 1").get(name) !==
      undefined
    );
  }

  private row(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM plugins WHERE id=?").get(id) as
      Row | undefined;
  }

  private toPlugin(row: Row): InstalledPlugin {
    const manifest = JSON.parse(row.manifest_json) as PluginManifest;
    return {
      manifest,
      state: row.state,
      granted: row.granted_hash === row.manifest_hash,
      compatible: compatible(manifest, this.appVersion),
      permissions: describePermissions(manifest),
    };
  }
}
