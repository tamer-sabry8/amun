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
export const workPriority = z.enum(["low", "medium", "high", "urgent"]);
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
  "amun-brand",
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
  /** The item already existed in the destination, so it was linked, not created. */
  linked: z.boolean().optional(),
  /** An existing page was changed; nothing new was created. */
  updated: z.boolean().optional(),
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

export const documentAuthor = z.enum(["owner", "firstmate", "agent"]);
/**
 * Where a request stands, as Firstmate reported it. "sent" is Amun's own:
 * Firstmate took the message and has reported nothing since.
 */
export const requestStatus = z.enum([
  "sent",
  "queued",
  "waiting",
  "working",
  "needs-decision",
  "failed",
  "delivered",
]);
export type RequestStatus = z.infer<typeof requestStatus>;

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
      /** Only what the owner said; null when no priority was stated. */
      priority: workPriority.nullable(),
      /** Names the owner said belong inside this work ("Keep it here"). */
      keptHere: z.array(z.string()),
      /** The work's first chat: its name once it has one, and its archive mark. */
      firstChat: z.strictObject({
        title: z.string().nullable(),
        archivedAt: stamp.nullable(),
        /** Place among the chats pinned to Recent; null when not pinned. */
        pinOrder: z.number().nullable().optional(),
        /** Who named it: "owner" (a rename), "firstmate" or "" (first words). */
        titleBy: z.string().optional(),
      }),
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
      dueDate: stamp.nullable(),
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
  sprintDecisions: z
    .array(
      z.strictObject({
        ref: id,
        workAreaId: id,
        chatId: id,
        productId: id,
        sourceId: id,
        team: id,
        backlog: id,
        sprintId: id,
        storyId: z.int().positive(),
      }),
    )
    .optional(),
  sprintCarryovers: z
    .array(
      z.strictObject({
        workAreaId: id,
        productId: id,
        sourceId: id,
        team: id,
        chatId: id,
        ref: id,
        fromId: id,
        toId: id,
        title: z.string(),
        storyId: z.int().positive(),
        destination: z.string(),
        revision: z.int().positive(),
        storyUrl: z.string(),
      }),
    )
    .optional(),
  blockers: z.array(
    z.strictObject({
      id,
      workAreaId: id,
      title: z.string(),
      owner: z.string().nullable(),
      nudge: z
        .object({
          ref: id,
          text: z.string(),
          state: z.enum(["drafting", "draft", "copied", "manual", "failed"]),
        })
        .nullable()
        .optional(),
      ownerReplies: z
        .array(
          z.object({
            id: z.int(),
            version: z.int(),
            url: z.url(),
            body: z.string(),
            proposal: z.string().nullable(),
            state: z.enum(["pending", "unconfirmed", "reviewed"]),
          }),
        )
        .optional(),
      azureIndicator: z
        .object({
          rev: z.int().positive(),
          blocked: z.boolean(),
          checkedAt: stamp,
        })
        .optional(),
      azureCheckPending: z.boolean().optional(),
      sprintLink: z
        .object({
          sourceId: id,
          sprintId: id,
          storyId: id,
          teamId: id.optional(),
          trackAzureIndicator: z.literal(true).optional(),
        })
        .nullable()
        .optional(),
      raisedAt: stamp,
      resolvedAt: stamp.nullable(),
    }),
  ),
  reminders: z
    .array(
      z.strictObject({
        id,
        text: z.string(),
        dueAt: stamp,
        workAreaId: id.nullable(),
        state: z.enum(["scheduled", "due", "done", "cancelled"]),
        /** The time it was due, when Amun was closed or asleep then. */
        missedAt: stamp.nullable(),
      }),
    )
    .default([]),
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
      /** Estimated value, in dirhams. */
      value: z.number().nullable().default(null),
      nextStep: z.string().nullable().default(null),
      nextStepAt: stamp.nullable().default(null),
      /** Set while the RFP is on hold; its stage is kept underneath. */
      heldAt: stamp.nullable().default(null),
      holdReason: z.string().nullable().default(null),
      requirements: z.string().default(""),
      source: z.string().nullable().default(null),
      receivedAt: stamp.nullable().default(null),
      clarificationsBy: stamp.nullable().default(null),
      team: z.array(z.string()).default([]),
      /** When it was won, lost or withdrawn. */
      closedAt: stamp.nullable().default(null),
      /** Dated notes on where the RFP stands, newest first. */
      summaries: z
        .array(z.strictObject({ id, text: z.string(), createdAt: stamp }))
        .default([]),
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
      /** The latest version number; records have no history. */
      version: z.number().int().min(1).default(1),
      /** The version the owner approved, if any. */
      approvedVersion: z.number().int().min(1).nullable().default(null),
      /** The owner's acceptance of a checklist: separate from any publishing. */
      acceptance: z
        .strictObject({
          decision: z.enum(["accepted", "not_yet", "rejected"]),
          version: z.number().int().min(1),
          reason: z.string(),
          decidedAt: stamp,
        })
        .nullable()
        .default(null),
      /** The newest versions first, each with the text as it was then. */
      versions: z
        .array(
          z.strictObject({
            version: z.number().int().min(1),
            author: documentAuthor.nullable(),
            createdAt: stamp,
            body: z.string(),
          }),
        )
        .default([]),
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
    /** What Amun currently remembers, newest first: the owner can correct or forget each. */
    facts: z.array(
      z.strictObject({
        id,
        groupId: id.nullable(),
        key: z.string(),
        value: z.string(),
        source: z.string(),
        observedAt: stamp,
        confirmed: z.boolean(),
        synced: z.boolean(),
      }),
    ),
  }),
  messages: z.array(
    z.strictObject({
      id,
      workAreaId: id,
      role: z.enum(["you", "firstmate", "card"]),
      text: z.string(),
      card: z.json().nullable(),
      /** The model that wrote a Firstmate reply; empty on older messages. */
      model: z.string().max(200).nullable().optional(),
      createdAt: stamp,
      /** When the owner saw it; null is an unread reply. */
      readAt: stamp.nullable().optional(),
    }),
  ),
  /**
   * The chats inside a work besides its first one, oldest first: chats the
   * owner started and forks. `messages` above is each work's first chat.
   */
  chats: z
    .array(
      z.strictObject({
        id,
        workAreaId: id,
        title: z.string(),
        kind: z.enum(["fork", "chat"]),
        /** Set while the owner has archived it; it stays searchable. */
        archivedAt: stamp.nullable(),
        /** The message a fork was taken from, in the chat it came from. */
        forkedFrom: id.nullable(),
        /** The chat it came from; null is the main chat. */
        fromChatId: id.nullable(),
        createdAt: stamp,
        /** Place among the chats pinned to Recent; null when not pinned. */
        pinOrder: z.number().nullable().optional(),
        /** Who named it: "owner" (a rename), "firstmate" or "" (first words). */
        titleBy: z.string().optional(),
        messages: z.array(
          z.strictObject({
            id,
            workAreaId: id,
            role: z.enum(["you", "firstmate", "card"]),
            text: z.string(),
            card: z.json().nullable(),
            model: z.string().max(200).nullable().optional(),
            createdAt: stamp,
            readAt: stamp.nullable().optional(),
          }),
        ),
      }),
    )
    .default([]),
  /**
   * The owner's requests, each with the stable reference Firstmate repeats,
   * and the last status Firstmate confirmed for it.
   */
  requests: z
    .array(
      z.strictObject({
        ref: z.string().max(64),
        messageId: id,
        /** The project Firstmate confirmed; null for none (General). */
        projectAreaId: id.nullable(),
        status: requestStatus,
        role: z.string().max(120),
        detail: z.string().max(400),
        /** How many documents Firstmate said it will deliver; 0 if unsaid. */
        parts: z.int().min(0).max(20),
        updatedAt: stamp,
        /** A change of project the owner asked Firstmate for. */
        changeToAreaId: id.nullable(),
        changeState: z.enum(["", "requested", "refused"]),
      }),
    )
    .default([]),
});
export type WorkSnapshot = z.infer<typeof workSnapshot>;

const base = {
  version: z.literal(1),
  kind: z.literal("work"),
  /**
   * True when Firstmate already knows about this change: it asked for it in
   * its reply, or the owner's own message that caused it is being sent to it.
   * Anything else the owner does on a screen is told to Firstmate afterwards
   * (see `firstmate-notice.ts`). Never stored.
   */
  told: z.boolean().optional(),
};
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
    priority: workPriority.optional(),
  }),
  act("update-area", {
    areaId: id,
    patch: z.strictObject({
      name: name.optional(),
      groupId: id.optional(),
      purpose: text.optional(),
      client: text.nullable().optional(),
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
    dueDate: stamp.nullable().default(null),
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
    /** For a Firstmate reminder put off: the day it comes back, YYYY-MM-DD. */
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  act("raise-blocker", {
    areaId: id,
    title: name,
    owner: text.nullable().default(null),
  }),
  act("draft-blocker-message", {
    areaId: id,
    blockerId: id,
    chatId: id,
    ref: z.string().regex(/^amun-r-[0-9a-f]{12}$/),
  }),
  act("record-blocker-message", {
    areaId: id,
    blockerId: id,
    ref: id,
    body: z.string().trim().min(1).max(16000),
    disposition: z.enum(["copied", "manual"]),
  }),
  act("link-blocker-story", {
    areaId: id,
    blockerId: id,
    sourceId: id,
    sprintId: id,
    storyId: id,
    teamId: id.optional(),
    trackAzureIndicator: z.literal(true).optional(),
  }),
  act("set-blocker-owner", { blockerId: id, owner: text.nullable() }),
  act("resolve-blocker", { blockerId: id }),
  act("reminder", { text: z.string().max(16384), workAreaId: id.nullable() }),
  act("finish-reminder", { reminderId: id }),
  act("snooze-reminder", { reminderId: id }),
  act("cancel-reminder", { reminderId: id }),
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
  /** Changes only the fields given; the rest of the RFP is left as it is. */
  act("update-rfp", {
    areaId: id,
    patch: z.strictObject({
      value: z.number().nonnegative().max(1e12).nullable().optional(),
      nextStep: text.nullable().optional(),
      nextStepAt: stamp.nullable().optional(),
      requirements: longText.optional(),
      source: text.nullable().optional(),
      receivedAt: stamp.nullable().optional(),
      clarificationsBy: stamp.nullable().optional(),
      team: z.array(z.string().trim().min(1).max(200)).max(32).optional(),
    }),
  }),
  /** Puts an open RFP on hold with a reason, or takes it off hold. */
  act("hold-rfp", {
    areaId: id,
    held: z.boolean(),
    reason: text.default(""),
  }),
  act("add-rfp-summary", { areaId: id, text: text.min(1) }),
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
  act("edit-sprint-draft", {
    sprintId: id,
    workAreaId: id,
    name,
    goal: text,
    start: z.union([z.iso.date(), z.literal("")]),
    end: z.union([z.iso.date(), z.literal("")]),
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
    author: documentAuthor.default("owner"),
  }),
  act("restore-output-version", {
    outputId: id,
    versionNumber: z.number().int().min(1),
  }),
  // Only the owner's title menu sends this; nothing else approves a document.
  act("approve-output", {
    outputId: id,
    approved: z.boolean(),
    versionNumber: z.number().int().min(1).optional(),
  }),
  // Only the owner's title menu sends this; it never publishes or merges.
  act("record-acceptance", {
    outputId: id,
    decision: z.enum(["accepted", "not_yet", "rejected"]).nullable(),
    reason: z.string().trim().max(500).default(""),
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
  // A change the captain wants to an agent's brief; the First Mate makes it.
  act("edit-agent", { agentId: id, change: text.min(1) }),
  // What an agent is doing, reported by the service that started its worker.
  act("agent-status", {
    role: name,
    state: z.enum(["working", "waiting", "idle", "done"]),
    nowDoing: text.nullable().default(null),
    output: longText.optional(),
  }),
  act("navigation-activity", {
    ref: z.string().regex(/^amun-r-[0-9a-f]{12}$/),
    workAreaId: id.nullable(),
    prompt: text.min(1),
    delivered: z.boolean(),
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
  act("correct-claim", { claimId: id, value: text.min(1) }),
  act("forget-claim", { claimId: id }),
  act("resolve-claim", {
    attentionId: id,
    keep: z.enum(["current", "incoming"]),
  }),
  act("message", {
    workAreaId: id,
    /** A fork inside the work; null is the main chat. */
    chatId: id.nullable().default(null),
    role: z.enum(["you", "firstmate", "card"]),
    text: z.string().max(16384),
    card: z.json().nullable().default(null),
    model: z.string().max(200).nullable().default(null),
  }),
  /**
   * "Fork from here": a second chat in the same work, copied up to and
   * including this message. The chat it came from is not changed.
   */
  act("fork-chat", { workAreaId: id, messageId: id }),
  act("delete-chat", { chatId: id }),
  /** "New chat" in a folder: an empty chat, named by its first message. */
  act("new-chat", {
    workAreaId: id,
    sprint: z.strictObject({ connection: id, id, name }).optional(),
  }),
  /** `chatId` null is the work's first chat. */
  act("rename-chat", { workAreaId: id, chatId: id.nullable(), title: name }),
  /** Archived chats leave the sidebar, stay searchable and can come back. */
  act("archive-chat", {
    workAreaId: id,
    chatId: id.nullable(),
    archived: z.boolean(),
  }),
  /**
   * Re-files a chat's messages, from one message on (or all of them), as a
   * chat in another work. The chat they left keeps one line saying where the
   * conversation continued. Only ever sent after the owner said yes.
   */
  act("move-chat", {
    workAreaId: id,
    chatId: id.nullable(),
    fromMessageId: id.optional(),
    toWorkAreaId: id,
  }),
  /** Pin a chat to Recent at `order`, or unpin it (null). */
  act("pin-chat", {
    workAreaId: id,
    chatId: id.nullable(),
    order: z.number().nullable(),
  }),
  /** The owner has seen these replies. */
  act("read-messages", { messageIds: z.array(id).min(1).max(500) }),
  /** Firstmate's short topic title; never replaces the owner's own name. */
  act("suggest-chat-title", {
    workAreaId: id,
    chatId: id.nullable(),
    title: name,
  }),
  /** A request the owner sent, under its stable reference. */
  act("register-request", {
    ref: z.string().min(8).max(64),
    messageId: id,
    projectAreaId: id.nullable(),
  }),
  /**
   * A status Firstmate reported for a request. Unknown references are
   * refused; a report already applied (same fingerprint) changes nothing.
   */
  act("request-report", {
    ref: z.string().min(8).max(64),
    status: requestStatus.exclude(["sent"]),
    role: z.string().max(120).default(""),
    detail: z.string().max(400).default(""),
    parts: z.int().min(0).max(20).default(0),
    fingerprint: z.string().min(1).max(128),
  }),
  /**
   * Firstmate's report and document blocks from a reply. A result is linked
   * to a request only when its reference matches one Amun gave; anything
   * else stays where the reply arrived (`workAreaId`, `chatId`). With
   * `saveText`, the reply's own words are kept too: in the chat of the
   * request it is about, when every reference points to the same chat.
   */
  act("apply-reply", {
    text: z.string().max(200000),
    workAreaId: id,
    chatId: id.nullable(),
    saveText: z.boolean().default(false),
    prdRelay: z.boolean().optional(),
    /**
     * Raise plan blocks for approval. Only for replies nobody asked for; the
     * window raises the plans in replies to the owner's own messages.
     */
    raisePlans: z.boolean().optional(),
    model: z.string().max(200).nullable().default(null),
  }),
  act("record-firstmate-reply", {
    text: z.string().max(200000),
    model: z.string().max(200).nullable().default(null),
  }),
  /** The owner asked Firstmate to move a request to another project. */
  act("request-change", {
    ref: z.string().min(8).max(64),
    toAreaId: id.nullable(),
  }),
  /** Firstmate confirmed (or refused) the change of project. */
  act("request-change-result", {
    ref: z.string().min(8).max(64),
    accepted: z.boolean(),
  }),
  /** "Keep it here": this name belongs inside this work; do not ask again. */
  act("keep-here", { workAreaId: id, name }),
  /** Replaces what a card message holds, for example once it is answered. */
  act("settle-card", { messageId: id, card: z.json() }),
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
  /** The job is an acceptance checklist: every item cites its evidence. */
  acceptance: z.boolean().optional(),
  /** The job changes code in this connected repository (its https address). */
  repo: z
    .url({ protocol: /^https$/ })
    .max(512)
    .optional(),
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

/** Search by content; the service limits it to the owner's current group. */
export const contentSearch = z.strictObject({
  version: z.literal(1),
  kind: z.literal("content-search"),
  requestId: id,
  query: z.string().max(200),
});
export const contentSearchResult = z.strictObject({
  version: z.literal(1),
  kind: z.literal("content-search-result"),
  requestId: id,
  hits: z.array(
    z.strictObject({
      kind: z.enum(["document", "record", "message", "step"]),
      id,
      title: z.string(),
      snippet: z.array(
        z.strictObject({ text: z.string(), match: z.boolean() }),
      ),
      workAreaId: id.nullable(),
      /** A message: who wrote it. A step: always Firstmate. */
      role: z.enum(["you", "firstmate"]).nullable().optional(),
      at: z.string().max(64).nullable().optional(),
      /** A step: the Firstmate script behind it, when there is one. */
      script: z.string().max(200).nullable().optional(),
    }),
  ),
});

/** One thing Firstmate did in a turn, read from its saved timeline. */
export const happenedStep = z.strictObject({
  id: z.string().max(64),
  kind: z.enum(["action", "answer", "problem"]),
  words: z.string(),
  script: z.string().nullable(),
  at: z.string().max(64),
  durationMs: z.number().nullable(),
  sent: z.string(),
  cameBack: z.string(),
  failed: z.boolean(),
});
export const happenedTurn = z.strictObject({
  id: z.string().max(64),
  trigger: z.enum(["you", "woke"]),
  prompt: z.string(),
  at: z.string().max(64),
  durationMs: z.number().nullable(),
  workAreaId: z.string().nullable(),
  steps: z.array(happenedStep),
});
export type HappenedStep = z.infer<typeof happenedStep>;
export type HappenedTurn = z.infer<typeof happenedTurn>;
/** "What happened" in one conversation. Read only; nothing is run again. */
export const whatHappened = z.strictObject({
  version: z.literal(1),
  kind: z.literal("what-happened"),
  requestId: id,
  workAreaId: id,
});
export const whatHappenedResult = z.strictObject({
  version: z.literal(1),
  kind: z.literal("what-happened-result"),
  requestId: id,
  /** False when Firstmate has no saved steps to read yet. */
  available: z.boolean(),
  turns: z.array(happenedTurn),
});

export type ContentSearchHit = z.infer<
  typeof contentSearchResult
>["hits"][number];

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
      /** The work item type Azure DevOps will create, in the project's words. */
      kind: z.string().max(128).nullable().optional(),
      /** Said when an item was created as a different type than planned. */
      note: z.string().max(400).nullable().optional(),
      /** An item with this title already exists in the destination. */
      existing: z
        .strictObject({ id: z.string().max(256) })
        .nullable()
        .optional(),
      /** The exact change to an existing Notion page, line by line. */
      change: z
        .array(
          z.strictObject({
            kind: z.enum(["same", "add", "remove"]),
            text: z.string().max(4096),
          }),
        )
        .max(2000)
        .nullable()
        .optional(),
      /** The exact text a new Notion page will hold, secrets already removed. */
      content: z.string().max(20000).nullable().optional(),
      /** Plain words for why the destination did not take this item. */
      failure: z.string().max(400).nullable().optional(),
      /** The page changed in Notion after Amun wrote it; nothing was sent. */
      changedInNotion: z.boolean().optional(),
      /** How a field travels when the type has no field of its own for it. */
      sentAs: z.string().max(400).optional(),
      /** The existing work item a new Azure DevOps item is created under. */
      parent: z
        .strictObject({
          id: z.string().max(16),
          title: z.string().max(512).nullable(),
          /** Said when it cannot be read in this project; blocks approval. */
          problem: z.string().max(400).nullable(),
        })
        .nullable()
        .optional(),
    }),
  ),
});
/** Asks which work item types a work area's Azure DevOps project uses. */
export const trackerTypes = z.strictObject({
  version: z.literal(1),
  kind: z.literal("tracker-types"),
  workAreaId: id,
});
export const trackerTypesResult = z.strictObject({
  version: z.literal(1),
  kind: z.literal("tracker-types-result"),
  workAreaId: id,
  project: z.string().max(256).nullable(),
  story: z.string().max(128).nullable(),
  task: z.string().max(128).nullable(),
  /** Fields the project requires per type that the owner must give values for. */
  needs: z
    .array(
      z.strictObject({
        type: z.string().max(128),
        fields: z.array(z.string().max(256)).max(20),
      }),
    )
    .max(4),
});
/** Check or retry an approved plan's outstanding items; never a new approval. */
export const planPublish = z.strictObject({
  version: z.literal(1),
  kind: z.literal("plan-publish"),
  planId: id,
  /** Re-run only the items that were not created, within the same approval. */
  retry: z.boolean().optional(),
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

/** Where a payload broke the contract: paths and codes only, never values. */
export function issueReasons(error: z.ZodError, limit = 20) {
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const keys =
      issue.code === "unrecognized_keys" ? ` [${issue.keys.join(",")}]` : "";
    seen.add(`${issue.path.join(".") || "(root)"}: ${issue.code}${keys}`);
    if (seen.size >= limit) break;
  }
  return [...seen];
}
/** Why a failure happened, as paths and codes only (never values). */
export function failureReasons(error: unknown): string[] {
  if (error instanceof z.ZodError) return issueReasons(error);
  const code = (error as { code?: unknown } | null)?.code;
  return [
    `(snapshot): ${error instanceof Error ? error.name : "error"}${
      typeof code === "string" ? " " + code.slice(0, 64) : ""
    }`,
  ];
}
const reasonList = z.array(z.string().max(300)).max(20);
/** The service could not build the workspace snapshot. */
export const workSnapshotFailed = z.strictObject({
  version: z.literal(1),
  kind: z.literal("work-snapshot-failed"),
  reasons: reasonList,
});
/** The renderer could not read a snapshot; it tells the service why. */
export const workDiagnostic = z.strictObject({
  version: z.literal(1),
  kind: z.literal("work-diagnostic"),
  reasons: reasonList,
});
export const workEvent = z.discriminatedUnion("kind", [
  toolsReport,
  workSnapshotFailed,
  workAttachmentResult,
  planPlacesResult,
  contentSearchResult,
  whatHappenedResult,
  trackerTypesResult,
  workSnapshot,
  councilStatus,
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("work-result"),
    commandId: z.uuid().optional(),
    action: z.string().max(64),
    ok: z.boolean(),
    message: z.string().max(1024),
    ref: z.string().max(256).nullable(),
    step: z.json().nullable(),
  }),
]);
export type WorkEvent = z.infer<typeof workEvent>;
