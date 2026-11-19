import { z } from "zod";

// Amun RPC: typed payloads that the Amun UI exchanges with the daemon over
// the `/amun` WebSocket. They describe Firstmate state ($FM_HOME fleet
// snapshots, captain holds, backlog rows) and Amun's own PM records.
// Additive only: nothing here changes an existing Paseo message.

export const AMUN_RPC_VERSION = 1;

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

export const primaryHarnessSchema = z.enum(["pi", "claude", "codex", "agy"]);
export type PrimaryHarness = z.infer<typeof primaryHarnessSchema>;

export const runtimeBackendSchema = z.enum(["tmux", "hc"]);
export type RuntimeBackend = z.infer<typeof runtimeBackendSchema>;

export const productSpaceSchema = z.object({
  slug,
  name: z.string().min(1).max(200),
  fmHome: z.string(),
  backend: runtimeBackendSchema,
  harness: primaryHarnessSchema,
  createdAt: z.string(),
});
export type ProductSpace = z.infer<typeof productSpaceSchema>;

// --- Firstmate fleet snapshot (schema fm-fleet-snapshot.v1) -------------------
// Only the fields Amun reads are named; every object stays open (loose) so a
// newer Firstmate that adds fields keeps parsing.

export const backlogRecordSchema = z.looseObject({
  id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  state: z.enum(["in_flight", "queued", "done"]).nullable().optional(),
  kind: z.string().nullable().optional(),
  structured: z.boolean().optional(),
  raw: z.string().optional(),
  since: z.string().nullable().optional(),
  repo: z.string().nullable().optional(),
  priority: z.number().nullable().optional(),
  pr_url: z.string().nullable().optional(),
  report_path: z.string().nullable().optional(),
  links: z.array(z.unknown()).optional(),
  hold_kind: z.string().nullable().optional(),
  hold_reason: z.string().nullable().optional(),
  hold_until: z.string().nullable().optional(),
  hold_bucket: z.string().nullable().optional(),
  captain_actionable: z.boolean().optional(),
  blocked_by_ids: z.array(z.string()).optional(),
});
export type BacklogRecord = z.infer<typeof backlogRecordSchema>;

export const crewCurrentStateSchema = z.looseObject({
  state: z.string(),
  source: z.string(),
  detail: z.string(),
  raw: z.string().optional(),
  observed_at: z.string().optional(),
});

export const openDecisionSchema = z.looseObject({
  key: z.string(),
  verb: z.string(),
  summary: z.string(),
});
export type OpenDecision = z.infer<typeof openDecisionSchema>;

export const fleetTaskSchema = z.looseObject({
  id: z.string(),
  kind: z.string().nullable().optional(),
  harness: z.string().nullable().optional(),
  mode: z.string().nullable().optional(),
  project: z.string().nullable().optional(),
  backend: z.string().nullable().optional(),
  paths: z
    .looseObject({
      worktree: z.looseObject({ path: z.string().nullable(), present: z.boolean() }).optional(),
      report: z.looseObject({ path: z.string().nullable(), present: z.boolean() }).optional(),
    })
    .optional(),
  current_state: crewCurrentStateSchema.optional(),
  hints: z
    .looseObject({
      pending_decision: z.boolean().optional(),
      blocked_event: z.boolean().optional(),
      open_decisions: z.array(openDecisionSchema).optional(),
      last_event_text: z.string().nullable().optional(),
    })
    .optional(),
  backlog: backlogRecordSchema.nullable().optional(),
});
export type FleetTask = z.infer<typeof fleetTaskSchema>;

export const fleetSnapshotSchema = z.looseObject({
  schema: z.literal("fm-fleet-snapshot.v1"),
  generated: z.string(),
  fm_home: z.string(),
  backlog: z.looseObject({
    path: z.string().nullable().optional(),
    present: z.boolean(),
    records: z.array(backlogRecordSchema),
  }),
  tasks: z.array(fleetTaskSchema),
  scout_reports: z.array(z.unknown()).optional(),
});
export type FleetSnapshot = z.infer<typeof fleetSnapshotSchema>;

// --- Captain holds (the decision triage feed) -------------------------------

export const captainHoldSchema = z.discriminatedUnion("source", [
  // A backlog row held for the captain (bin/fm-captain-hold.sh hold).
  z.object({
    source: z.literal("backlog"),
    taskId: z.string(),
    title: z.string(),
    reason: z.string(),
    until: z.string().nullable(),
  }),
  // A keyed needs-decision / blocked line in a crew's status log.
  z.object({
    source: z.literal("crew"),
    taskId: z.string(),
    key: z.string(),
    verb: z.enum(["needs-decision", "blocked"]),
    summary: z.string(),
  }),
]);
export type CaptainHold = z.infer<typeof captainHoldSchema>;

// --- Board ------------------------------------------------------------------

export const boardColumnSchema = z.enum([
  "backlog",
  "discovery",
  "spec",
  "in_progress",
  "review",
  "done",
]);
export type BoardColumn = z.infer<typeof boardColumnSchema>;

// --- Connections (Azure DevOps first; secrets stay in the daemon's Keychain) --

export const connectionKindSchema = z.enum(["ado", "github", "notion", "obsidian"]);
export const connectionSchema = z.object({
  kind: connectionKindSchema,
  baseUrl: z.string().url().max(2048),
});
export type ConnectionRef = z.infer<typeof connectionSchema>;

// --- Requests (UI -> daemon) --------------------------------------------------

export const amunRequestSchema = z.discriminatedUnion("method", [
  z.object({ id: z.string(), method: z.literal("spaces.list") }),
  z.object({
    id: z.string(),
    method: z.literal("spaces.create"),
    name: z.string().min(1).max(200),
    slug: slug.optional(),
    harness: primaryHarnessSchema.optional(),
  }),
  z.object({ id: z.string(), method: z.literal("fleet.snapshot"), space: slug }),
  z.object({ id: z.string(), method: z.literal("holds.list"), space: slug }),
  z.object({
    id: z.string(),
    method: z.literal("crew.peek"),
    space: slug,
    taskId: z.string().regex(/^[-a-zA-Z0-9_]{1,64}$/),
  }),
  z.object({
    id: z.string(),
    method: z.literal("holds.answer"),
    space: slug,
    hold: captainHoldSchema,
    answer: z.string().min(1).max(8000),
  }),
  z.object({
    id: z.string(),
    method: z.literal("primary.start"),
    space: slug,
    harness: primaryHarnessSchema.optional(),
  }),
  z.object({
    id: z.string(),
    method: z.literal("primary.send"),
    space: slug,
    text: z.string().min(1).max(32000),
  }),
  // The First Mate's model: what Pi offers from its signed-in accounts, and a
  // switch for the running First Mate. Model sign-ins stay inside Pi; Amun
  // only asks Pi whether a provider is ready.
  z.object({ id: z.string(), method: z.literal("models.list"), space: slug }),
  z.object({
    id: z.string(),
    method: z.literal("primary.setModel"),
    space: slug,
    model: z.string().regex(/^[-a-zA-Z0-9_.]{1,64}\/[-a-zA-Z0-9_.:/@]{1,200}$/),
  }),
  z.object({
    id: z.string(),
    method: z.literal("accounts.check"),
    provider: z.string().regex(/^[a-z0-9][-a-z0-9]{0,63}$/),
  }),
  z.object({ id: z.string(), method: z.literal("backlog.list"), space: slug }),
  z.object({ id: z.string(), method: z.literal("board.get"), space: slug }),
  z.object({ id: z.string(), method: z.literal("initiatives.list"), space: slug }),
  z.object({
    id: z.string(),
    method: z.literal("initiative.upsert"),
    space: slug,
    initiative: z.object({
      id: z.string().min(1).max(128),
      title: z.string().min(1).max(500),
      what: z.string().max(8000).optional(),
      why: z.string().max(8000).optional(),
      when: z.string().max(8000).optional(),
      cost: z.string().max(8000).optional(),
      status: z.enum(["proposed", "approved", "in_delivery", "shipped", "dropped"]).optional(),
      roadmapId: z.string().optional(),
    }),
  }),
  z.object({ id: z.string(), method: z.literal("connections.list") }),
  z.object({
    id: z.string(),
    method: z.literal("connections.save"),
    connection: connectionSchema,
    secret: z.string().min(1).max(65536),
  }),
  z.object({ id: z.string(), method: z.literal("connections.check"), connection: connectionSchema }),
  z.object({ id: z.string(), method: z.literal("connections.forget"), connection: connectionSchema }),
  // Amun's local work model (areas, conversations, plans, reminders). The
  // command is the renderer's own work contract, validated by the work store.
  z.object({ id: z.string(), method: z.literal("work.snapshot") }),
  z.object({ id: z.string(), method: z.literal("work.command"), command: z.record(z.string(), z.unknown()) }),
  // Read-only: words inside conversations, documents and the First Mate's own
  // saved steps; and the turns and steps behind one conversation ("What
  // happened"). Neither starts the First Mate or sends it anything.
  z.object({ id: z.string(), method: z.literal("work.search"), query: z.string().max(200) }),
  z.object({ id: z.string(), method: z.literal("happened.read"), workAreaId: z.string().min(1).max(128) }),
  // Trace bundle: a redacted zip of what happened, for the captain to share
  // when something goes wrong; and a one-time request that the First Mate
  // keep agent history (fleet ledger, status archive) in its home.
  z.object({ id: z.string(), method: z.literal("trace.export"), space: slug.optional() }),
  z.object({ id: z.string(), method: z.literal("trace.history"), space: slug }),
  // Products, their mapped sources, PRDs and priorities (Amun's workspace
  // contract), and Azure DevOps backlog reads and governed writes, which use
  // the saved connection's Keychain token inside the daemon only.
  z.object({ id: z.string(), method: z.literal("workspace.snapshot") }),
  z.object({ id: z.string(), method: z.literal("workspace.command"), command: z.record(z.string(), z.unknown()) }),
  z.object({ id: z.string(), method: z.literal("ado.request"), message: z.record(z.string(), z.unknown()) }),
  // Agent command-line tools on this Mac (the renderer's "tools" contract):
  // look for them, and remember which the captain turned off or added.
  z.object({ id: z.string(), method: z.literal("tools.request"), message: z.record(z.string(), z.unknown()) }),
  // The Council (Roast Room), in the renderer's "council" contract: status,
  // a run, seats on or off, updates and the live room. The Chair runs on this
  // Mac's Claude Code (the captain's decision, 18 November 2026).
  z.object({ id: z.string(), method: z.literal("council.request"), message: z.record(z.string(), z.unknown()) }),
  // Notion (the renderer's "auth" notion-* actions and linked-memory
  // commands). Sign-in is Notion's hosted MCP server in an external browser;
  // answers that need the browser or the network arrive as renderer.event.
  z.object({ id: z.string(), method: z.literal("notion.request"), message: z.record(z.string(), z.unknown()) }),
]);
export type AmunRequest = z.infer<typeof amunRequestSchema>;
export type AmunMethod = AmunRequest["method"];

// --- Responses and pushed events (daemon -> UI) -------------------------------

export const amunResponseSchema = z.union([
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type AmunResponse = z.infer<typeof amunResponseSchema>;

export const amunEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("fleet.updated"), space: slug, snapshot: fleetSnapshotSchema }),
  z.object({ event: z.literal("holds.updated"), space: slug, holds: z.array(captainHoldSchema) }),
  // Amun's own work model changed outside a request (a Council question
  // arrived, or a council ended); the UI reads the work snapshot again.
  z.object({ event: z.literal("work.updated") }),
  // A message for the renderer, already in its own contract, that arrives
  // after the request that caused it has been answered (a finished sign-in).
  z.object({ event: z.literal("renderer.event"), message: z.record(z.string(), z.unknown()) }),
  z.object({
    event: z.literal("primary.output"),
    space: slug,
    agentId: z.string(),
    text: z.string(),
  }),
]);
export type AmunEvent = z.infer<typeof amunEventSchema>;
