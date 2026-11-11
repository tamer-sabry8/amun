/**
 * Plugin manifests: what an extension is, where it comes from, what it adds
 * and what it is allowed to reach. Validation is pure; the catalog stores
 * manifests and the permissions a person granted.
 */

export const pluginKinds = [
  "model_provider",
  "connector",
  "skill",
  "workflow",
  "interface",
  "policy",
] as const;
export type PluginKind = (typeof pluginKinds)[number];

export const pluginOrigins = [
  "first_party",
  "customer",
  "third_party",
] as const;
export type PluginOrigin = (typeof pluginOrigins)[number];

export const originLabels: Record<PluginOrigin, string> = {
  first_party: "Built in",
  customer: "Your organisation",
  third_party: "Third party",
};

export interface PluginPermissions {
  /** Hosts the plugin may contact. */
  network?: readonly string[];
  /** Kinds of data it may read. */
  reads?: readonly string[];
  /** Kinds of data or systems it may change. */
  writes?: readonly string[];
  /** Named credentials it needs. Values are never part of a manifest. */
  credentials?: readonly string[];
}

export interface WorkflowStage {
  id: string;
  title: string;
  /** A person must approve before the next stage starts. */
  humanCheckpoint?: boolean;
  /** How the stage's result is checked before moving on. */
  validation?: string;
  /** Stage ids that may follow. Absent means the next stage in order. */
  next?: readonly string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  kind: PluginKind;
  origin: PluginOrigin;
  version: string;
  description: string;
  /** Oldest Amun version the plugin works with. */
  minAppVersion?: string;
  /** First Amun version the plugin does not work with. */
  maxAppVersion?: string;
  permissions?: PluginPermissions;
  /** model_provider: provider name and endpoint understood by Pi. */
  provider?: { name: string; baseUrl: string };
  /** connector: an MCP server reached over stdio or streamable HTTP. */
  connector?: { transport: "stdio" | "http"; target: string };
  /** skill: name of a skill already reviewed in the skills library. */
  skill?: { name: string };
  /** workflow: ordered stages with decision points and checkpoints. */
  workflow?: { stages: readonly WorkflowStage[] };
  /** interface: widget kinds and the slot each appears in. */
  interface?: { widgets: readonly { kind: string; slot: string }[] };
  /** policy: named rules the runtime consults. A policy can only restrict. */
  policy?: {
    rules: readonly { name: string; effect: "deny" | "require_approval" }[];
  };
}

const idPattern = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const slots = ["island", "activity", "notifications", "inline", "toast"];

export function parseVersion(version: string): [number, number, number] | null {
  const match = versionPattern.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative when left is older, zero when equal, positive when newer. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw Error("Versions must look like 1.2.3");
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** True when the plugin declares support for this version of Amun. */
export function compatible(
  manifest: PluginManifest,
  appVersion: string,
): boolean {
  return (
    (manifest.minAppVersion === undefined ||
      compareVersions(appVersion, manifest.minAppVersion) >= 0) &&
    (manifest.maxAppVersion === undefined ||
      compareVersions(appVersion, manifest.maxAppVersion) < 0)
  );
}

function list(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort();
}

/** Permissions in a fixed order, so equal grants compare and hash equally. */
export function normalizePermissions(
  permissions: PluginPermissions | undefined,
): Required<{ [K in keyof PluginPermissions]: string[] }> {
  return {
    network: list(permissions?.network),
    reads: list(permissions?.reads),
    writes: list(permissions?.writes),
    credentials: list(permissions?.credentials),
  };
}

/** Plain sentences a person reads before granting a plugin its access. */
export function describePermissions(manifest: PluginManifest): string[] {
  const p = normalizePermissions(manifest.permissions);
  const lines = [
    p.network.length ? "Contacts: " + p.network.join(", ") : "",
    p.reads.length ? "Reads: " + p.reads.join(", ") : "",
    p.writes.length ? "Changes: " + p.writes.join(", ") : "",
    p.credentials.length
      ? "Needs credentials: " + p.credentials.join(", ")
      : "",
  ].filter(Boolean);
  return lines.length ? lines : ["Needs no access to your data or network"];
}

/** Permissions the new manifest asks for that the old one did not. */
export function addedPermissions(
  before: PluginManifest,
  after: PluginManifest,
): string[] {
  const old = normalizePermissions(before.permissions);
  const next = normalizePermissions(after.permissions);
  return (Object.keys(next) as (keyof typeof next)[]).flatMap((key) =>
    next[key]
      .filter((value) => !old[key].includes(value))
      .map((value) => key + ": " + value),
  );
}

/** Every problem with a manifest. An empty list means it is valid. */
export function manifestProblems(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return ["A manifest must be an object"];
  const m = input as Partial<PluginManifest>;
  const problems: string[] = [];
  if (typeof m.id !== "string" || !idPattern.test(m.id))
    problems.push("id must be lowercase letters, digits and hyphens");
  if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 80)
    problems.push("name is required");
  if (!pluginKinds.includes(m.kind as PluginKind))
    problems.push("kind is not a supported extension point");
  if (!pluginOrigins.includes(m.origin as PluginOrigin))
    problems.push("origin must be first_party, customer or third_party");
  if (typeof m.version !== "string" || !parseVersion(m.version))
    problems.push("version must look like 1.2.3");
  if (typeof m.description !== "string" || !m.description.trim())
    problems.push("description is required");
  for (const key of ["minAppVersion", "maxAppVersion"] as const)
    if (m[key] !== undefined && !parseVersion(String(m[key])))
      problems.push(key + " must look like 1.2.3");
  const permissions = m.permissions ?? {};
  for (const key of ["network", "reads", "writes", "credentials"] as const) {
    const values = permissions[key];
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        values.some((v) => typeof v !== "string" || !v.trim()))
    )
      problems.push(`permissions.${key} must be a list of names`);
  }
  if ((permissions.network ?? []).some((host) => /[/*\s]|^\d+\.\d+/.test(host)))
    problems.push("permissions.network takes exact host names");
  const host = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" ? parsed.hostname : null;
    } catch {
      return null;
    }
  };
  const reach = (url: string, what: string) => {
    const name = host(url);
    if (!name) problems.push(what + " must be an https URL");
    else if (!(permissions.network ?? []).includes(name))
      problems.push(
        `${what} contacts ${name}, which permissions.network omits`,
      );
  };
  if (m.kind === "model_provider") {
    if (!m.provider?.name?.trim()) problems.push("provider.name is required");
    reach(m.provider?.baseUrl ?? "", "provider.baseUrl");
  }
  if (m.kind === "connector") {
    if (!m.connector || !["stdio", "http"].includes(m.connector.transport))
      problems.push("connector.transport must be stdio or http");
    else if (m.connector.transport === "http")
      reach(m.connector.target, "connector.target");
    else if (!m.connector.target.trim())
      problems.push("connector.target is required");
  }
  if (m.kind === "skill" && !/^[a-z][a-z0-9-]{0,63}$/.test(m.skill?.name ?? ""))
    problems.push("skill.name must name a skill in the skills library");
  if (m.kind === "workflow") {
    const stages = m.workflow?.stages ?? [];
    const ids = stages.map((stage) => stage.id);
    if (stages.length === 0) problems.push("workflow needs at least one stage");
    if (new Set(ids).size !== ids.length)
      problems.push("workflow stage ids must be unique");
    for (const stage of stages) {
      if (!stage.id?.trim() || !stage.title?.trim())
        problems.push("every workflow stage needs an id and a title");
      for (const next of stage.next ?? [])
        if (!ids.includes(next))
          problems.push(`stage ${stage.id} leads to unknown stage ${next}`);
    }
    if (stages.length && !stages.some((stage) => stage.validation?.trim()))
      problems.push("workflow must say how at least one result is validated");
  }
  if (m.kind === "interface") {
    const widgets = m.interface?.widgets ?? [];
    if (widgets.length === 0) problems.push("interface needs a widget");
    for (const widget of widgets) {
      if (!slots.includes(widget.slot))
        problems.push("unknown widget slot " + widget.slot);
      if (typeof m.id === "string" && !widget.kind.startsWith(m.id + "."))
        problems.push(`widget kind ${widget.kind} must start with ${m.id}.`);
    }
  }
  if (m.kind === "policy") {
    const rules = m.policy?.rules ?? [];
    if (rules.length === 0) problems.push("policy needs a rule");
    if (rules.some((r) => !["deny", "require_approval"].includes(r.effect)))
      problems.push("a policy can only deny or require approval");
  }
  return problems;
}

/** Where a workflow goes after a stage, and whether a person must approve. */
export function nextStages(
  stages: readonly WorkflowStage[],
  current: string,
): { stages: string[]; needsApproval: boolean } {
  const index = stages.findIndex((stage) => stage.id === current);
  const stage = stages[index];
  if (!stage) throw Error("Unknown workflow stage");
  const following = stages[index + 1];
  return {
    stages: stage.next ? [...stage.next] : following ? [following.id] : [],
    needsApproval: stage.humanCheckpoint === true,
  };
}
