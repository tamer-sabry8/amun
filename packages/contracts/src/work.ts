// Contract for the UX rebuild: groups, work areas, records, objectives,
// routing, permissions, plans, RFPs, roadmap, sprints, Library, Decisions,
// Council and setup. Renderer ⇄ service over the existing message port.
import { z } from "zod";

const id = z.string().min(1).max(256);
const name = z.string().trim().min(1).max(256);
const text = z.string().trim().max(4096);
const longText = z.string().max(100000);
const stamp = z.string().max(64);
export const workType = z.enum(["product", "project", "task", "rfp"]);
export const recordType = z.enum(["idea", "problem", "interview", "document"]);
export const linkage = z.enum([
  "linked",
  "link_later",
  "unlinked",
  "unresolved",
]);
export const horizon = z.enum(["now", "next", "later"]);
export const effort = z.enum(["XS", "S", "M", "L"]);
export const rfpStage = z.enum([
  "received",
  "in_response",
  "submitted",
  "won",
  "handed_to_delivery",
  "lost",
  "withdrawn",
]);
const themeChoice = z.enum([
  "system",
  "tamer-sabry-default",
  "navy-gold",
  "navy-cyan",
  "amun-light",
  "nimbus",
  "nimbus-maritime",
  "nimbus-warm",
  "df-aurora",
  "df-copper",
  "df-ember",
  "df-garnet",
  "df-midnight",
  "df-neumorph",
  "df-sage",
  "df-slate",
  "lg-slate",
  "lg-nous",
  "lg-midnight",
  "lg-ember",
  "lg-mono",
  "lg-cyberpunk",
]);
const planItem = z.strictObject({
  id,
  summary: z.string().max(1024),
  fields: z.record(
    z.string().max(128),
    z.union([z.string().max(1024), z.number(), z.null()]),
  ),
});
const writeResult = z.strictObject({
  id,
  state: z.enum(["created", "failed", "unknown"]),
  externalId: z.string().max(256).optional(),
  /** Where the created item can be opened. */
  url: z.string().max(2048).optional(),
});
const planStory = z.strictObject({
  id,
  title: z.string().max(512),
  points: z.number().nullable(),
  owner: z.string().max(256).nullable(),
});
const rice = {
  reach: z.number().nullable(),
  impact: z.number().nullable(),
  confidence: z.number().nullable(),
  effort: z.number().nullable(),
};

export const setupState = z.strictObject({
  completed: z.boolean().default(false),
  step: z.enum(["models", "tools", "work", "agents"]).default("models"),
  workTypes: z.array(workType).default([]),
  tools: z.array(z.string().max(64)).max(64).default([]),
  theme: themeChoice.default("system"),
  lastSeenAt: stamp.nullable().default(null),
  activeGroupId: id.nullable().default(null),
  libraryView: z.enum(["gallery", "list"]).default("gallery"),
  libraryGroupBy: z.enum(["work", "type", "none"]).default("work"),
});
export type SetupState = z.infer<typeof setupState>;
// A patch carries only the fields being changed; defaults must not apply here.
export const setupPatch = z.strictObject({
  step: z.enum(["models", "tools", "work", "agents"]).optional(),
  theme: themeChoice.optional(),
  activeGroupId: id.nullable().optional(),
  libraryView: z.enum(["gallery", "list"]).optional(),
  libraryGroupBy: z.enum(["work", "type", "none"]).optional(),
});

export const workSnapshot = z.strictObject({
  version: z.literal(1),
  kind: z.literal("work-snapshot"),
  setup: setupState,
  groups: z.array(z.strictObject({ id, name, position: z.int() })),
  routes: z.array(
    z.strictObject({
      id,
      groupId: id,
      condition: z.enum(["delivery", "product", "task", "rfp"]).nullable(),
      tracker: z.string().max(64),
    }),
  ),
  areas: z.array(
    z.strictObject({
      id,
      groupId: id.nullable(),
      type: workType,
      name,
      purpose: z.string(),
      status: z.string(),
      productId: id.nullable(),
      stakeholder: z.int(),
      client: z.string().nullable(),
      clientWeight: z.int(),
      dueAt: stamp.nullable(),
      effort: effort.nullable(),
      milestones: z.int(),
      people: z.int(),
      steps: z.int(),
      declinedShape: z
        .strictObject({ milestones: z.int(), people: z.int(), steps: z.int() })
        .nullable(),
      convertedFrom: workType.nullable(),
      lastContextAt: stamp.nullable(),
      interest: z.int(),
      createdAt: stamp,
    }),
  ),
  relations: z.array(
    z.strictObject({
      fromId: id,
      toId: id,
      kind: z.enum(["implements", "handoff"]),
    }),
  ),
  records: z.array(
    z.strictObject({
      id,
      groupId: id.nullable(),
      type: recordType,
      title: z.string(),
      body: z.string(),
      linkage,
      links: z.array(id),
      createdAt: stamp,
    }),
  ),
  objectives: z.array(
    z.strictObject({
      id,
      groupId: id.nullable(),
      metric: z.string(),
      baseline: z.number().nullable(),
      target: z.number().nullable(),
      current: z.number().nullable(),
      evidenceDate: stamp.nullable(),
      reviewDate: stamp.nullable(),
      conflict: z.boolean(),
      links: z.array(id),
    }),
  ),
  permissions: z.array(
    z.strictObject({
      id,
      groupId: id,
      destination: z.string(),
      action: z.string(),
      createdAt: stamp,
      revokedAt: stamp.nullable(),
    }),
  ),
  grants: z.array(
    z.strictObject({
      id,
      sourceGroupId: id,
      targetGroupId: id,
      information: z.string(),
      purpose: z.string(),
      targetRef: id.nullable(),
      createdAt: stamp,
      revokedAt: stamp.nullable(),
    }),
  ),
  rules: z.array(
    z.strictObject({
      id,
      groupId: id,
      situation: z.string(),
      resolution: z.string(),
      state: z.enum(["active", "declined", "never", "revoked"]),
      examples: z.int(),
      uses: z.int(),
    }),
  ),
  ruleCandidate: z
    .strictObject({
      groupId: id,
      situation: z.string(),
      resolution: z.string(),
      examples: z.int(),
      ask: z.string(),
    })
    .nullable(),
  attention: z.array(
    z.strictObject({
      id,
      kind: z.enum([
        "approval",
        "question",
        "risk",
        "failure",
        "result",
        "offer",
        "linking",
      ]),
      groupId: id.nullable(),
      workAreaId: id.nullable(),
      title: z.string(),
      detail: z.string(),
      state: z.enum(["open", "done", "snoozed"]),
      ref: z.string().nullable(),
      options: z.array(z.string()),
      answer: z.string().nullable(),
      createdAt: stamp,
    }),
  ),
  plans: z.array(
    z.strictObject({
      id,
      groupId: id.nullable(),
      workAreaId: id.nullable(),
      kind: z.enum(["stories", "sprint_plan", "roadmap", "edit"]),
      destination: z.string(),
      summary: z.string(),
      items: z.array(planItem),
      fingerprint: z.string(),
      state: z.enum([
        "proposed",
        "approved",
        "changes_requested",
        "published",
        "partial",
        "failed",
      ]),
      results: z.array(writeResult),
      /** The plan these items were left out of at approval, if any. */
      splitFrom: id.nullable(),
      createdAt: stamp,
    }),
  ),
  rfps: z.array(
    z.strictObject({
      id,
      client: z.string(),
      stage: rfpStage,
      deadline: stamp.nullable(),
      responseOwner: z.string().nullable(),
      accountOwner: z.string().nullable(),
      presales: z.string().nullable(),
      proposalSigned: z.boolean(),
      brdApproved: z.boolean(),
      deliveryProjectId: id.nullable(),
      lossReason: z.string().nullable(),
    }),
  ),
  roadmap: z.array(
    z.strictObject({
      id,
      workAreaId: id,
      title: z.string(),
      horizon,
      position: z.int(),
      committed: z.boolean(),
      estimated: z.boolean(),
      release: z.string().nullable(),
      start: stamp.nullable(),
      end: stamp.nullable(),
      ...rice,
    }),
  ),
  sprints: z.array(
    z.strictObject({
      id,
      workAreaId: id,
      name: z.string(),
      team: z.string().nullable(),
      start: stamp,
      end: stamp,
      goal: z.string(),
      draft: z.boolean(),
      done: z.int(),
      total: z.int(),
      blocked: z.int(),
      changedInAdo: z.boolean(),
      capacity: z.number().nullable(),
      stories: z.array(planStory),
      out: z.array(planStory),
    }),
  ),
  calendar: z.array(z.strictObject({ date: stamp, label: z.string() })),
  library: z.array(
    z.strictObject({
      id,
      section: z.enum(["output", "record"]),
      type: z.string(),
      title: z.string(),
      groupId: id.nullable(),
      workAreaIds: z.array(id),
      status: z.string(),
      needsLinking: z.boolean(),
      body: z.string(),
      updatedAt: stamp,
    }),
  ),
  decisions: z.array(
    z.strictObject({
      id,
      groupId: id.nullable(),
      workAreaId: id.nullable(),
      what: z.string(),
      options: z.array(z.string()),
      decidedBy: z.enum(["you", "client", "firstmate_recommended"]).nullable(),
      decidedAt: stamp.nullable(),
      outcome: z.string().nullable(),
      affected: z.array(z.string()),
      source: z.enum(["conversation", "council", "exception"]),
    }),
  ),
  agents: z.array(
    z.strictObject({
      id,
      role: z.string(),
      kind: z.enum(["lead", "always_on", "temporary"]),
      launcherId: id.nullable(),
      state: z.enum(["working", "waiting", "idle", "done"]),
      nowDoing: z.string().nullable(),
      output: z.string(),
      enabled: z.boolean(),
    }),
  ),
  activity: z.array(
    z.strictObject({
      id,
      groupId: id.nullable(),
      workAreaId: id.nullable(),
      text: z.string(),
      state: z.enum(["running", "finished", "failed"]),
      progress: z.number().nullable(),
      ref: z.string().nullable(),
      createdAt: stamp,
    }),
  ),
  council: z.array(
    z.strictObject({
      id,
      decision: z.string(),
      groupId: id.nullable(),
      workAreaId: id.nullable(),
      mode: z.string(),
      state: z.enum(["running", "waiting_on_you", "finished", "failed"]),
      recommendation: z.string().nullable(),
      createdAt: stamp,
    }),
  ),
  findings: z.array(
    z.strictObject({
      id,
      recordId: id,
      text: z.string(),
      decisions: z.array(
        z.strictObject({
          workAreaId: id,
          planId: id,
          state: z.enum([
            "proposed",
            "approved",
            "written",
            "write_failed",
            "rejected",
            "deferred",
          ]),
        }),
      ),
    }),
  ),
  memory: z.strictObject({
    /** Facts saved on this Mac that are not yet in the memory home. */
    unsynced: z.int(),
    disputed: z.int(),
  }),
  messages: z.array(
    z.strictObject({
      id,
      workAreaId: id,
      role: z.enum(["you", "firstmate", "card"]),
      text: z.string(),
      card: z.json().nullable(),
      createdAt: stamp,
    }),
  ),
});
export type WorkSnapshot = z.infer<typeof workSnapshot>;

const base = { version: z.literal(1), kind: z.literal("work") };
const act = <A extends string, S extends z.ZodRawShape>(action: A, shape: S) =>
  z.strictObject({ ...base, action: z.literal(action), ...shape });

export const workCommand = z.discriminatedUnion("action", [
  act("snapshot", {}),
  act("setup", { patch: setupPatch }),
  act("finish-setup", {
    workTypes: z.array(workType),
    tools: z.array(z.string().max(64)).max(64),
    agents: z.array(name).max(32),
    groups: z
      .array(
        z.strictObject({
          name,
          routes: z
            .array(
              z.strictObject({
                condition: z
                  .enum(["delivery", "product", "task", "rfp"])
                  .nullable(),
                tracker: z.string().min(1).max(64),
              }),
            )
            .max(8),
        }),
      )
      .max(16),
  }),
  act("seen", {}),
  act("add-group", { name }),
  act("rename-group", { groupId: id, name }),
  act("set-route", {
    groupId: id,
    condition: z.enum(["delivery", "product", "task", "rfp"]).nullable(),
    tracker: z.string().min(1).max(64),
  }),
  act("intake", {
    text: z.string().max(16384),
    fileNames: z.array(z.string().max(255)).max(32).default([]),
    groupId: id.nullable(),
  }),
  act("create-area", {
    groupId: id.nullable(),
    type: workType,
    name,
    purpose: text.default(""),
    client: text.optional(),
    dueAt: stamp.optional(),
    effort: effort.optional(),
    stakeholder: z.int().min(0).max(3).optional(),
  }),
  act("update-area", {
    areaId: id,
    patch: z.strictObject({
      name: name.optional(),
      groupId: id.optional(),
      purpose: text.optional(),
      status: z.string().max(64).optional(),
      dueAt: stamp.nullable().optional(),
      effort: effort.nullable().optional(),
      stakeholder: z.int().min(0).max(3).optional(),
      clientWeight: z.int().min(0).max(3).optional(),
      milestones: z.int().min(0).max(999).optional(),
      people: z.int().min(0).max(999).optional(),
      steps: z.int().min(0).max(9999).optional(),
    }),
  }),
  act("delete-area", { areaId: id }),
  act("touch-area", { areaId: id, asked: z.boolean().default(false) }),
  act("convert-task", { areaId: id, convert: z.boolean() }),
  act("relate-areas", {
    fromId: id,
    toId: id,
    relation: z.enum(["implements", "handoff"]),
  }),
  act("save-record", {
    groupId: id.nullable(),
    type: recordType,
    title: name,
    body: longText.default(""),
  }),
  act("link-record", {
    recordId: id,
    choice: z.enum(["link", "later", "never"]),
    workAreaIds: z.array(id).max(32).default([]),
  }),
  act("grant-cross-group", {
    sourceGroupId: id,
    targetGroupId: id,
    information: text.min(1),
    purpose: text.min(1),
    targetRef: id.nullable().default(null),
  }),
  act("revoke-grant", { grantId: id }),
  act("save-objective", {
    objectiveId: id.optional(),
    groupId: id.nullable(),
    metric: name,
    baseline: z.number().nullable(),
    target: z.number().nullable(),
    current: z.number().nullable(),
    evidenceDate: stamp.nullable().default(null),
    reviewDate: stamp.nullable().default(null),
    conflict: z.boolean().default(false),
    workAreaIds: z.array(id).max(32),
  }),
  act("add-permission", {
    groupId: id,
    destination: z.string().min(1).max(64),
    permit: z.string().min(1).max(64),
  }),
  act("revoke-permission", { permissionId: id }),
  act("rule-case", {
    groupId: id,
    situation: name,
    resolution: text.min(1),
    eventId: id,
  }),
  act("decide-rule", {
    groupId: id,
    situation: name,
    resolution: text.min(1),
    choice: z.enum(["remember", "not_now", "never"]),
  }),
  act("revoke-rule", { ruleId: id }),
  act("propose-plan", {
    groupId: id.nullable(),
    workAreaId: id.nullable(),
    planKind: z.enum(["stories", "sprint_plan", "roadmap", "edit"]),
    destination: z.string().min(1).max(64),
    summary: text,
    items: z.array(planItem).min(1).max(500),
  }),
  act("update-plan", { planId: id, items: z.array(planItem).min(1).max(500) }),
  act("approve-plan", {
    planId: id,
    fingerprint: z.string().max(200000),
    /** Approve only these items; the rest stay proposed. Omit for all. */
    itemIds: z.array(id).min(1).max(500).optional(),
  }),
  act("request-changes", { planId: id, note: text.default("") }),
  act("record-results", { planId: id, results: z.array(writeResult).max(500) }),
  act("attention", {
    attentionKind: z.enum([
      "approval",
      "question",
      "risk",
      "failure",
      "result",
      "offer",
      "linking",
    ]),
    groupId: id.nullable(),
    workAreaId: id.nullable(),
    title: name,
    detail: text.default(""),
    ref: z.string().max(256).nullable().default(null),
    options: z.array(z.string().max(512)).max(8).default([]),
  }),
  act("resolve-attention", {
    attentionId: id,
    resolution: z.enum(["done", "snooze", "answer", "accept"]),
    answer: z.string().max(16384).optional(),
  }),
  act("save-rfp", {
    areaId: id.optional(),
    groupId: id.nullable(),
    name,
    client: text.default(""),
    deadline: stamp.nullable().default(null),
    responseOwner: text.nullable().default(null),
    accountOwner: text.nullable().default(null),
    presales: text.nullable().default(null),
  }),
  act("move-rfp", {
    areaId: id,
    stage: rfpStage,
    lossReason: text.nullable().default(null),
  }),
  act("rfp-readiness", {
    areaId: id,
    proposalSigned: z.boolean(),
    brdApproved: z.boolean(),
  }),
  act("handoff-rfp", { areaId: id }),
  act("save-roadmap-item", {
    itemId: id.optional(),
    workAreaId: id,
    title: name,
    horizon,
    release: z.string().max(128).nullable().default(null),
    start: stamp.nullable().default(null),
    end: stamp.nullable().default(null),
    estimated: z.boolean().default(false),
    ...rice,
  }),
  act("move-roadmap-item", {
    itemId: id,
    horizon,
    index: z.int().min(0).max(10000),
  }),
  act("save-sprint", {
    sprintId: id.optional(),
    workAreaId: id,
    name,
    team: text.nullable().default(null),
    start: stamp,
    end: stamp,
    goal: text.default(""),
    draft: z.boolean().default(true),
    capacity: z.number().nonnegative().nullable().default(null),
    stories: z.array(planStory).max(500).default([]),
    out: z.array(planStory).max(500).default([]),
  }),
  act("move-sprint-story", {
    sprintId: id,
    storyId: id,
    list: z.enum(["stories", "out"]),
    owner: z.string().max(256).nullable().optional(),
  }),
  act("calendar-exception", { date: stamp, label: name }),
  act("save-output", {
    outputId: id.optional(),
    groupId: id.nullable(),
    type: z.string().min(1).max(64),
    title: name,
    body: longText.default(""),
    status: z.string().max(64).default("Draft"),
    workAreaIds: z.array(id).max(32).default([]),
  }),
  act("record-decision", {
    decisionId: id.optional(),
    groupId: id.nullable(),
    workAreaId: id.nullable(),
    what: name,
    options: z.array(z.string().max(512)).max(8).default([]),
    outcome: text.nullable().default(null),
    decidedBy: z
      .enum(["you", "client", "firstmate_recommended"])
      .nullable()
      .default(null),
    affected: z.array(z.string().max(256)).max(32).default([]),
    source: z
      .enum(["conversation", "council", "exception"])
      .default("conversation"),
  }),
  act("scope-answer", {
    workAreaId: id,
    item: name,
    answer: z.enum(["add_anyway", "link_cr", "keep_out"]),
  }),
  act("add-agent", {
    description: text.min(1),
    always: z.boolean().default(true),
  }),
  act("toggle-agent", { agentId: id, enabled: z.boolean() }),
  // What an agent is doing, reported by the service that started its worker.
  act("agent-status", {
    role: name,
    state: z.enum(["working", "waiting", "idle", "done"]),
    nowDoing: text.nullable().default(null),
    output: longText.optional(),
  }),
  act("activity", {
    groupId: id.nullable(),
    workAreaId: id.nullable(),
    text: name,
    state: z.enum(["running", "finished", "failed"]),
    progress: z.number().min(0).max(1).nullable().default(null),
    ref: z.string().max(256).nullable().default(null),
    activityId: id.optional(),
    // A turn the user watched finish needs no separate attention item.
    silent: z.boolean().default(false),
  }),
  act("council-session", {
    sessionId: id.optional(),
    decision: name,
    groupId: id.nullable(),
    workAreaId: id.nullable(),
    mode: z.string().max(64),
    state: z.enum(["running", "waiting_on_you", "finished", "failed"]),
    recommendation: text.nullable().default(null),
  }),
  act("save-finding", {
    recordId: id,
    text: text.min(1),
    workAreaIds: z.array(id).min(1).max(16),
  }),
  act("defer-finding", { findingId: id, workAreaId: id }),
  act("external-change", {
    workAreaId: id,
    sprintId: id.nullable().default(null),
    itemId: z.string().min(1).max(128),
    field: name,
    before: z.string().max(512).nullable(),
    after: z.string().max(512).nullable(),
    affectsCommitment: z.boolean(),
  }),
  act("record-claim", {
    groupId: id.nullable(),
    key: name,
    value: text.min(1),
    source: text.min(1),
    observedAt: stamp,
    confirmed: z.boolean(),
  }),
  act("resolve-claim", {
    attentionId: id,
    keep: z.enum(["current", "incoming"]),
  }),
  act("message", {
    workAreaId: id,
    role: z.enum(["you", "firstmate", "card"]),
    text: z.string().max(16384),
    card: z.json().nullable().default(null),
  }),
]);
export type WorkCommand = z.infer<typeof workCommand>;

export const councilStatus = z.strictObject({
  version: z.literal(1),
  kind: z.literal("council-status"),
  installed: z.boolean(),
  commit: z.string().max(64).nullable(),
  previous: z.string().max(64).nullable(),
  repo: z.string().max(512).nullable(),
  /** Claude Code was found on this Mac; councils run on it. */
  claude: z.boolean(),
  seats: z
    .array(
      z.strictObject({
        key: z.string().max(128),
        name: z.string().max(256),
        disabled: z.boolean(),
      }),
    )
    .max(64),
  /** Address of the live room while it is open, on this Mac only. */
  roomUrl: z.string().max(128).nullable(),
  message: z.string().max(1024),
});
export type CouncilStatus = z.infer<typeof councilStatus>;
export const councilCommand = z.discriminatedUnion("action", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("council"),
    action: z.literal("status"),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("council"),
    action: z.literal("run"),
    text: z.string().min(1).max(8192),
    workAreaId: id.nullable(),
    groupId: id.nullable(),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("council"),
    action: z.literal("toggle-seat"),
    key: z.string().min(1).max(128),
    disabled: z.boolean(),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("council"),
    action: z.enum(["check-update", "rollback", "room", "close-room"]),
  }),
]);
/** Firstmate hands a piece of work to one of the agents. */
export const workDelegate = z.strictObject({
  version: z.literal(1),
  kind: z.literal("work-delegate"),
  workAreaId: id,
  /** The agent's name from the catalogue; never an id from the model. */
  agent: name,
  title: name,
  task: z.string().trim().min(1).max(8000),
});
/** A file added from the composer: read on the Mac and filed in the Library. */
export const workAttachment = z.strictObject({
  version: z.literal(1),
  kind: z.literal("work-attachment"),
  requestId: id,
  workAreaId: id,
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/\\\x00-\x1f]+$/),
  bytes: z.instanceof(Uint8Array),
});
export const workAttachmentResult = z.strictObject({
  version: z.literal(1),
  kind: z.literal("work-attachment-result"),
  requestId: id,
  name: z.string(),
  format: z.string(),
  read: z.enum(["all", "part", "none"]),
  /** Share of the text that was read, 0–1; null unless only part was. */
  portion: z.number().nullable(),
  /** Redacted text for Firstmate; empty when nothing could be read. */
  text: z.string(),
  /** A limit or unread portion, in plain words. */
  note: z.string().nullable(),
  /** The Library record holding it, when it could be filed. */
  recordId: z.string().nullable(),
});

/** Where each item of a plan would be written, in words the owner can check. */
export const planPlaces = z.strictObject({
  version: z.literal(1),
  kind: z.literal("plan-places"),
  planId: id,
});
export const planPlacesResult = z.strictObject({
  version: z.literal(1),
  kind: z.literal("plan-places-result"),
  planId: id,
  places: z.array(
    z.strictObject({
      id,
      destination: z.string(),
      /** The exact place, or null when none is chosen or connected yet. */
      place: z.string().nullable(),
      /** What to do when there is no place. */
      problem: z.string().nullable(),
    }),
  ),
});
/** Check or retry an approved plan's outstanding items; never a new approval. */
export const planPublish = z.strictObject({
  version: z.literal(1),
  kind: z.literal("plan-publish"),
  planId: id,
});
/** Open a created item in the browser. Only links Amun recorded are opened. */
export const planOpen = z.strictObject({
  version: z.literal(1),
  kind: z.literal("plan-open"),
  planId: id,
  itemId: id,
});
/** Agent command-line tools on this Mac: look, and remember choices. */
export const toolsCommand = z.discriminatedUnion("action", [
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("tools"),
    action: z.literal("refresh"),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("tools"),
    action: z.literal("enable"),
    id: z.string().max(64),
    enabled: z.boolean(),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("tools"),
    action: z.literal("default"),
    id: z.string().max(64),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("tools"),
    action: z.literal("add"),
    label: z.string().trim().min(1).max(64),
    path: z.string().min(2).max(1024),
  }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("tools"),
    action: z.literal("remove"),
    id: z.string().max(64),
  }),
]);
export const toolsReport = z.strictObject({
  version: z.literal(1),
  kind: z.literal("tools-report"),
  /** A problem with the last change, in plain words. */
  message: z.string(),
  tools: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      status: z.enum([
        "ready",
        "needs_sign_in",
        "not_installed",
        "outdated",
        "blocked",
        "disabled",
      ]),
      version: z.string().nullable(),
      path: z.string().nullable(),
      access: z.string(),
      dataShared: z.string(),
      nextAction: z.string(),
      origin: z.enum(["detected", "manual"]),
      isDefault: z.boolean(),
      lifecycleEvents: z.boolean(),
    }),
  ),
});
export type ToolsReport = z.infer<typeof toolsReport>;
export const workEvent = z.discriminatedUnion("kind", [
  toolsReport,
  workAttachmentResult,
  planPlacesResult,
  workSnapshot,
  councilStatus,
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("work-result"),
    action: z.string().max(64),
    ok: z.boolean(),
    message: z.string().max(1024),
    ref: z.string().max(256).nullable(),
    step: z.json().nullable(),
  }),
]);
export type WorkEvent = z.infer<typeof workEvent>;
