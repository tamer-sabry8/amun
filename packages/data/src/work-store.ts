// Storage and command handling for the UX rebuild model (migration 29).
// Decisions come from packages/domain/src/work; this file persists them.
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { Redactor } from "../../security/src/redaction.ts";
import {
  setupState,
  workCommand,
  workSnapshot,
  type SetupState,
  type WorkCommand,
  type WorkEvent,
  type WorkSnapshot,
} from "../../contracts/src/work.ts";
import {
  intake,
  linkRecord,
  nameFromRequest,
  type WorkArea,
} from "../../domain/src/work/model.ts";
import {
  changeSinceApproval,
  gateFor,
  gateLabels,
  planFingerprint,
  ruleCandidate,
  writeSummary,
  type Plan,
} from "../../domain/src/work/permissions.ts";
import {
  externalChange,
  memoryUpdate,
  rfpHandoff,
} from "../../domain/src/work/flows.ts";
import { moveStory, resequence } from "../../domain/src/work/planning.ts";

type Row = Record<string, unknown>;
type Step = Parameters<typeof JSON.stringify>[0];
const bool = (value: unknown) => value === 1;
const list = (value: unknown) => JSON.parse(String(value ?? "[]"));

export class WorkStore {
  private readonly db: Database.Database;
  private readonly redactor: Redactor;
  private readonly now: () => Date;
  constructor(
    db: Database.Database,
    redactor = new Redactor(),
    now: () => Date = () => new Date(),
  ) {
    this.db = db;
    this.redactor = redactor;
    this.now = now;
  }
  private stamp() {
    return this.now().toISOString();
  }
  private all(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  private get(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  private run(sql: string, ...params: unknown[]) {
    return this.db.prepare(sql).run(...params);
  }
  private clean(value: string) {
    return this.redactor.text(value);
  }

  setup(): SetupState {
    const row = this.get(
      "SELECT value_json FROM workspace_settings WHERE id='work_setup'",
    );
    return setupState.parse(row ? JSON.parse(String(row.value_json)) : {});
  }
  private saveSetup(value: SetupState) {
    this.run(
      "INSERT INTO workspace_settings(id,value_json) VALUES ('work_setup',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
      JSON.stringify(setupState.parse(value)),
    );
  }

  /** Products created through earlier flows become product work areas. */
  private adoptProducts() {
    this.run(
      "INSERT INTO work_areas(id,type,name,product_id,last_context_at,created_at) SELECT 'area-' || id,'product',name,id,created_at,created_at FROM products WHERE id NOT IN (SELECT product_id FROM work_areas WHERE product_id IS NOT NULL)",
    );
  }
  private areas(): WorkSnapshot["areas"] {
    return this.all("SELECT * FROM work_areas ORDER BY created_at,id").map(
      (row) => ({
        id: String(row.id),
        groupId: (row.group_id as string | null) ?? null,
        type: row.type as WorkArea["type"],
        name: String(row.name),
        purpose: String(row.purpose),
        status: String(row.status),
        productId: (row.product_id as string | null) ?? null,
        stakeholder: Number(row.stakeholder),
        client: (row.client as string | null) ?? null,
        clientWeight: Number(row.client_weight),
        dueAt: (row.due_at as string | null) ?? null,
        effort: (row.effort as "XS" | "S" | "M" | "L" | null) ?? null,
        milestones: Number(row.milestones),
        people: Number(row.people),
        steps: Number(row.steps),
        declinedShape: row.declined_shape_json
          ? JSON.parse(String(row.declined_shape_json))
          : null,
        convertedFrom: (row.converted_from as WorkArea["type"] | null) ?? null,
        lastContextAt: (row.last_context_at as string | null) ?? null,
        interest: Number(row.interest),
        createdAt: String(row.created_at),
      }),
    );
  }
  private plans(): WorkSnapshot["plans"] {
    return this.all("SELECT * FROM work_plans ORDER BY created_at,id").map(
      (row) => {
        const items = list(row.items_json);
        return {
          id: String(row.id),
          groupId: (row.group_id as string | null) ?? null,
          workAreaId: (row.work_area_id as string | null) ?? null,
          kind: row.kind as WorkSnapshot["plans"][number]["kind"],
          destination: String(row.destination),
          summary: String(row.summary),
          items,
          fingerprint: planFingerprint({
            destination: String(row.destination),
            items,
          }),
          state: row.state as WorkSnapshot["plans"][number]["state"],
          results: list(row.results_json),
          createdAt: String(row.created_at),
        };
      },
    );
  }

  snapshot(): WorkSnapshot {
    this.adoptProducts();
    this.run(
      "UPDATE work_attention SET state='open',snoozed_until=NULL WHERE state='snoozed' AND snoozed_until<=?",
      this.stamp(),
    );
    const links = (table: string, key: string) => {
      const map = new Map<string, string[]>();
      for (const row of this.all(
        `SELECT ${key} AS owner,work_area_id FROM ${table} ORDER BY work_area_id`,
      ))
        map.set(String(row.owner), [
          ...(map.get(String(row.owner)) ?? []),
          String(row.work_area_id),
        ]);
      return map;
    };
    const recordLinks = links("work_record_links", "record_id");
    const objectiveLinks = links("work_objective_links", "objective_id");
    const outputLinks = links("library_output_links", "output_id");
    const records = this.all(
      "SELECT * FROM work_records ORDER BY created_at,id",
    ).map((row) => ({
      id: String(row.id),
      groupId: (row.group_id as string | null) ?? null,
      type: row.type as WorkSnapshot["records"][number]["type"],
      title: String(row.title),
      body: String(row.body),
      linkage: row.linkage as WorkSnapshot["records"][number]["linkage"],
      links: recordLinks.get(String(row.id)) ?? [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
    const cases = this.all("SELECT * FROM rule_cases ORDER BY created_at").map(
      (row) => ({
        groupId: String(row.group_id),
        situation: String(row.situation),
        resolution: String(row.resolution),
        eventId: String(row.event_id),
      }),
    );
    const rules = this.all(
      "SELECT * FROM learned_rules ORDER BY created_at,id",
    ).map((row) => ({
      id: String(row.id),
      groupId: String(row.group_id),
      situation: String(row.situation),
      resolution: String(row.resolution),
      state: row.state as "active" | "declined" | "never" | "revoked",
      examples: cases.filter(
        (item) =>
          item.groupId === row.group_id && item.situation === row.situation,
      ).length,
      uses: Number(row.uses),
    }));
    // "Not now" is asked again only after further matching cases arrive.
    const declined = new Set(
      rules
        .filter(
          (rule) => rule.state === "declined" && rule.examples <= rule.uses,
        )
        .map((rule) => rule.groupId + "\u0000" + rule.situation),
    );
    const candidate = ruleCandidate(
      cases.filter(
        (item) => !declined.has(item.groupId + "\u0000" + item.situation),
      ),
      rules,
    );
    return workSnapshot.parse({
      version: 1,
      kind: "work-snapshot",
      setup: this.setup(),
      groups: this.all(
        "SELECT id,name,position FROM work_groups ORDER BY position,id",
      ),
      routes: this.all(
        "SELECT id,group_id AS groupId,condition,tracker FROM routing_rules ORDER BY created_at,id",
      ),
      areas: this.areas(),
      relations: this.all(
        "SELECT from_id AS fromId,to_id AS toId,kind FROM work_area_relations ORDER BY from_id,to_id",
      ),
      records: records.map((record) => ({
        id: record.id,
        groupId: record.groupId,
        type: record.type,
        title: record.title,
        body: record.body,
        linkage: record.linkage,
        links: record.links,
        createdAt: record.createdAt,
      })),
      objectives: this.all("SELECT * FROM work_objectives ORDER BY id").map(
        (row) => ({
          id: String(row.id),
          groupId: (row.group_id as string | null) ?? null,
          metric: String(row.metric),
          baseline: (row.baseline as number | null) ?? null,
          target: (row.target as number | null) ?? null,
          current: (row.current as number | null) ?? null,
          evidenceDate: (row.evidence_date as string | null) ?? null,
          reviewDate: (row.review_date as string | null) ?? null,
          conflict: bool(row.conflict),
          links: objectiveLinks.get(String(row.id)) ?? [],
        }),
      ),
      permissions: this.all(
        "SELECT id,group_id AS groupId,destination,action,created_at AS createdAt,revoked_at AS revokedAt FROM standing_permissions ORDER BY created_at,id",
      ),
      grants: this.all(
        "SELECT id,source_group_id AS sourceGroupId,target_group_id AS targetGroupId,information,purpose,target_ref AS targetRef,created_at AS createdAt,revoked_at AS revokedAt FROM cross_group_grants ORDER BY created_at,id",
      ),
      rules,
      ruleCandidate: candidate
        ? {
            groupId: candidate.groupId,
            situation: candidate.situation,
            resolution: candidate.resolution,
            examples: candidate.examples,
            ask: candidate.ask,
          }
        : null,
      attention: this.all(
        "SELECT * FROM work_attention ORDER BY created_at,id",
      ).map((row) => ({
        id: String(row.id),
        kind: row.kind,
        groupId: (row.group_id as string | null) ?? null,
        workAreaId: (row.work_area_id as string | null) ?? null,
        title: String(row.title),
        detail: String(row.detail),
        state: row.state,
        ref: (row.ref as string | null) ?? null,
        options: list(row.options_json),
        answer: (row.answer as string | null) ?? null,
        createdAt: String(row.created_at),
      })),
      plans: this.plans(),
      rfps: this.all("SELECT * FROM rfps ORDER BY work_area_id").map((row) => ({
        id: String(row.work_area_id),
        client: String(row.client),
        stage: row.stage,
        deadline: (row.deadline as string | null) ?? null,
        responseOwner: (row.response_owner as string | null) ?? null,
        accountOwner: (row.account_owner as string | null) ?? null,
        presales: (row.presales as string | null) ?? null,
        proposalSigned: bool(row.proposal_signed),
        brdApproved: bool(row.brd_approved),
        deliveryProjectId: (row.delivery_project_id as string | null) ?? null,
        lossReason: (row.loss_reason as string | null) ?? null,
      })),
      roadmap: this.roadmap(),
      sprints: this.all("SELECT * FROM work_sprints ORDER BY start,id").map(
        (row) => ({
          id: String(row.id),
          workAreaId: String(row.work_area_id),
          name: String(row.name),
          team: (row.team as string | null) ?? null,
          start: String(row.start),
          end: String(row.end),
          goal: String(row.goal),
          draft: bool(row.draft),
          done: Number(row.done),
          total: Number(row.total),
          blocked: Number(row.blocked),
          changedInAdo: bool(row.changed_in_ado),
          capacity: (row.capacity as number | null) ?? null,
          stories: list(row.stories_json),
          out: list(row.out_json),
        }),
      ),
      calendar: this.all(
        "SELECT date,label FROM calendar_exceptions ORDER BY date",
      ),
      library: [
        ...this.all(
          "SELECT * FROM library_outputs ORDER BY updated_at DESC,id",
        ).map((row) => ({
          id: String(row.id),
          section: "output" as const,
          type: String(row.type),
          title: String(row.title),
          groupId: (row.group_id as string | null) ?? null,
          workAreaIds: outputLinks.get(String(row.id)) ?? [],
          status: String(row.status),
          needsLinking: false,
          body: String(row.body),
          updatedAt: String(row.updated_at),
        })),
        ...records.map((record) => ({
          id: record.id,
          section: "record" as const,
          type: record.type,
          title: record.title,
          groupId: record.groupId,
          workAreaIds: record.links,
          status:
            record.linkage === "linked"
              ? "Linked"
              : record.linkage === "unlinked"
                ? "Unlinked"
                : "Needs linking",
          needsLinking:
            record.linkage === "link_later" || record.linkage === "unresolved",
          body: record.body,
          updatedAt: record.updatedAt,
        })),
      ],
      decisions: this.all(
        "SELECT * FROM decision_log ORDER BY created_at,id",
      ).map((row) => ({
        id: String(row.id),
        groupId: (row.group_id as string | null) ?? null,
        workAreaId: (row.work_area_id as string | null) ?? null,
        what: String(row.what),
        options: list(row.options_json),
        decidedBy: row.decided_by ?? null,
        decidedAt: (row.decided_at as string | null) ?? null,
        outcome: (row.outcome as string | null) ?? null,
        affected: list(row.affected_json),
        source: row.source,
      })),
      agents: this.all(
        "SELECT * FROM work_agents ORDER BY kind='lead' DESC,created_at,rowid",
      ).map((row) => ({
        id: String(row.id),
        role: String(row.role),
        kind: row.kind,
        launcherId: (row.launcher_id as string | null) ?? null,
        state: row.state,
        nowDoing: (row.now_doing as string | null) ?? null,
        output: String(row.output),
        enabled: bool(row.enabled),
      })),
      activity: this.all(
        "SELECT id,group_id AS groupId,work_area_id AS workAreaId,text,state,progress,ref,created_at AS createdAt FROM work_activity ORDER BY created_at DESC,id LIMIT 500",
      ),
      council: this.all(
        "SELECT id,decision,group_id AS groupId,work_area_id AS workAreaId,mode,state,recommendation,created_at AS createdAt FROM council_sessions ORDER BY created_at DESC,id",
      ),
      findings: this.findings(),
      memory: {
        unsynced: Number(
          this.get(
            "SELECT count(*) AS n FROM memory_claims WHERE synced=0 AND state='current'",
          )?.n ?? 0,
        ),
        disputed: Number(
          this.get(
            "SELECT count(*) AS n FROM memory_claims WHERE state='disputed'",
          )?.n ?? 0,
        ),
      },
      messages: this.all(
        "SELECT id,work_area_id AS workAreaId,role,text,card_json,created_at AS createdAt FROM work_messages ORDER BY created_at,rowid",
      ).map(({ card_json, ...row }) => ({
        ...row,
        card: card_json ? JSON.parse(String(card_json)) : null,
      })),
    });
  }
  /** Each finding keeps a separate decision per work area (UC03, UC05). */
  private findings(): WorkSnapshot["findings"] {
    const state = {
      proposed: "proposed",
      approved: "approved",
      published: "written",
      partial: "write_failed",
      failed: "write_failed",
      changes_requested: "rejected",
    } as const;
    const links = this.all(
      "SELECT f.finding_id,f.work_area_id,f.plan_id,f.deferred,p.state FROM finding_plans f JOIN work_plans p ON p.id=f.plan_id ORDER BY f.work_area_id",
    );
    return this.all("SELECT * FROM findings ORDER BY created_at,id").map(
      (row) => ({
        id: String(row.id),
        recordId: String(row.record_id),
        text: String(row.text),
        decisions: links
          .filter((link) => link.finding_id === row.id)
          .map((link) => ({
            workAreaId: String(link.work_area_id),
            planId: String(link.plan_id),
            state:
              bool(link.deferred) && link.state === "changes_requested"
                ? ("deferred" as const)
                : state[link.state as keyof typeof state],
          })),
      }),
    );
  }
  private roadmap(): WorkSnapshot["roadmap"] {
    return this.all(
      "SELECT * FROM roadmap_items ORDER BY horizon,position,id",
    ).map((row) => ({
      id: String(row.id),
      workAreaId: String(row.work_area_id),
      title: String(row.title),
      horizon: row.horizon as "now" | "next" | "later",
      position: Number(row.position),
      committed: bool(row.committed),
      estimated: bool(row.estimated),
      release: (row.release as string | null) ?? null,
      start: (row.start as string | null) ?? null,
      end: (row.end as string | null) ?? null,
      reach: (row.reach as number | null) ?? null,
      impact: (row.impact as number | null) ?? null,
      confidence: (row.confidence as number | null) ?? null,
      effort: (row.effort as number | null) ?? null,
    }));
  }

  private attend(input: {
    kind: string;
    groupId: string | null;
    workAreaId: string | null;
    title: string;
    detail?: string;
    ref?: string | null;
    options?: string[];
  }) {
    const id = randomUUID();
    this.run(
      "INSERT INTO work_attention(id,kind,group_id,work_area_id,title,detail,state,ref,options_json,created_at) VALUES (?,?,?,?,?,?,'open',?,?,?)",
      id,
      input.kind,
      input.groupId,
      input.workAreaId,
      this.clean(input.title),
      this.clean(input.detail ?? ""),
      input.ref ?? null,
      JSON.stringify(input.options ?? []),
      this.stamp(),
    );
    return id;
  }
  private activity(input: {
    groupId: string | null;
    workAreaId: string | null;
    text: string;
    state: "running" | "finished" | "failed";
    ref?: string | null;
    progress?: number | null;
  }) {
    const id = randomUUID();
    this.run(
      "INSERT INTO work_activity(id,group_id,work_area_id,text,state,progress,ref,created_at) VALUES (?,?,?,?,?,?,?,?)",
      id,
      input.groupId,
      input.workAreaId,
      this.clean(input.text),
      input.state,
      input.progress ?? null,
      input.ref ?? null,
      this.stamp(),
    );
    return id;
  }
  private groupOf(areaId: string | null) {
    if (!areaId) return null;
    const row = this.get("SELECT group_id FROM work_areas WHERE id=?", areaId);
    if (!row) throw new WorkError("That work area no longer exists.");
    return (row.group_id as string | null) ?? null;
  }
  private requireGroup(groupId: string | null) {
    if (groupId && !this.get("SELECT 1 FROM work_groups WHERE id=?", groupId))
      throw new WorkError("That group no longer exists.");
  }
  private createArea(input: {
    groupId: string | null;
    type: WorkArea["type"];
    name: string;
    purpose?: string;
    client?: string | undefined;
    dueAt?: string | undefined;
    effort?: string | undefined;
    stakeholder?: number | undefined;
    convertedFrom?: string;
  }) {
    this.requireGroup(input.groupId);
    const name = this.clean(input.name);
    // Never silently create a duplicate of the same kind in the same group.
    const twin = this.get(
      "SELECT id FROM work_areas WHERE type=? AND lower(name)=lower(?) AND ifnull(group_id,'')=ifnull(?,'')",
      input.type,
      name,
      input.groupId,
    );
    if (twin) return { id: String(twin.id), existing: true };
    const id = randomUUID();
    const now = this.stamp();
    let productId: string | null = null;
    if (input.type === "product") {
      productId = randomUUID();
      this.run(
        "INSERT INTO products(id,name,allowed_models_json,created_at) VALUES (?,?,'[]',?)",
        productId,
        name,
        now,
      );
    }
    this.run(
      "INSERT INTO work_areas(id,group_id,type,name,purpose,product_id,client,due_at,effort,stakeholder,last_context_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      input.groupId,
      input.type,
      name,
      this.clean(input.purpose ?? ""),
      productId,
      input.client ? this.clean(input.client) : null,
      input.dueAt ?? null,
      input.effort ?? null,
      input.stakeholder ?? 0,
      now,
      now,
    );
    return { id, existing: false };
  }

  handle(input: unknown): WorkEvent[] {
    const parsed = workCommand.safeParse(input);
    if (!parsed.success) return [];
    const command = parsed.data;
    if (command.action === "snapshot") return [this.snapshot()];
    let result: {
      message: string;
      ref: string | null;
      step: Step;
      ok: boolean;
    };
    try {
      const outcome = this.db
        .transaction(() => this.apply(command))
        .immediate();
      result = { ok: true, message: "", ref: null, step: null, ...outcome };
    } catch (error) {
      if (!(error instanceof WorkError)) throw error;
      result = {
        ok: false,
        message: error.message,
        ref: null,
        step: error.step,
      };
    }
    return [
      {
        version: 1,
        kind: "work-result",
        action: command.action,
        ok: result.ok,
        message: result.message,
        ref: result.ref,
        step: result.step ?? null,
      },
      this.snapshot(),
    ];
  }

  private apply(command: Exclude<WorkCommand, { action: "snapshot" }>): {
    message?: string;
    ref?: string | null;
    step?: Step;
    ok?: boolean;
  } {
    const now = this.stamp();
    switch (command.action) {
      case "setup":
        this.saveSetup({ ...this.setup(), ...stripUndefined(command.patch) });
        return {};
      case "seen":
        this.saveSetup({ ...this.setup(), lastSeenAt: now });
        return {};
      case "finish-setup": {
        for (const group of command.groups) {
          const id = this.addGroup(group.name);
          for (const route of group.routes)
            this.setRoute(id, route.condition, route.tracker);
        }
        if (!this.get("SELECT 1 FROM work_agents WHERE kind='lead'"))
          this.run(
            "INSERT INTO work_agents(id,role,kind,state,created_at) VALUES ('firstmate','Firstmate','lead','idle',?)",
            now,
          );
        for (const role of command.agents)
          if (!this.get("SELECT 1 FROM work_agents WHERE role=?", role))
            this.run(
              "INSERT INTO work_agents(id,role,kind,launcher_id,state,created_at) VALUES (?,?,'always_on','firstmate','idle',?)",
              randomUUID(),
              this.clean(role),
              now,
            );
        const groups = this.all("SELECT id FROM work_groups ORDER BY position");
        this.saveSetup({
          ...this.setup(),
          completed: true,
          workTypes: command.workTypes,
          tools: command.tools,
          lastSeenAt: now,
          // A single group is the obvious context; several are never merged.
          activeGroupId: groups.length === 1 ? String(groups[0]!.id) : null,
        });
        return {};
      }
      case "add-group":
        return { ref: this.addGroup(command.name) };
      case "rename-group": {
        this.requireGroup(command.groupId);
        const name = this.clean(command.name);
        if (
          this.get(
            "SELECT 1 FROM work_groups WHERE lower(name)=lower(?) AND id<>?",
            name,
            command.groupId,
          )
        )
          throw new WorkError("Another group already has that name.");
        this.run(
          "UPDATE work_groups SET name=? WHERE id=?",
          name,
          command.groupId,
        );
        return {};
      }
      case "set-route":
        this.requireGroup(command.groupId);
        this.setRoute(command.groupId, command.condition, command.tracker);
        return {};
      case "intake":
        return this.intake(command);
      case "create-area": {
        const created = this.createArea(command);
        return {
          ref: created.id,
          message: created.existing
            ? "That already exists, so I opened it."
            : "",
        };
      }
      case "update-area": {
        const area = this.get(
          "SELECT * FROM work_areas WHERE id=?",
          command.areaId,
        );
        if (!area) throw new WorkError("That work area no longer exists.");
        const patch = command.patch;
        // Boundaries never move silently: a group change is only ever the
        // user's own explicit choice, recorded here.
        if (patch.groupId !== undefined) this.requireGroup(patch.groupId);
        const columns: [string, unknown][] = [
          [
            "name",
            patch.name === undefined ? undefined : this.clean(patch.name),
          ],
          ["group_id", patch.groupId],
          [
            "purpose",
            patch.purpose === undefined ? undefined : this.clean(patch.purpose),
          ],
          ["status", patch.status],
          ["due_at", patch.dueAt],
          ["effort", patch.effort],
          ["stakeholder", patch.stakeholder],
          ["client_weight", patch.clientWeight],
          ["milestones", patch.milestones],
          ["people", patch.people],
          ["steps", patch.steps],
        ];
        for (const [column, value] of columns)
          if (value !== undefined)
            this.run(
              `UPDATE work_areas SET ${column}=? WHERE id=?`,
              value,
              command.areaId,
            );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id=?",
          now,
          command.areaId,
        );
        return {};
      }
      case "touch-area":
        this.run(
          "UPDATE work_areas SET last_context_at=?,interest=interest+? WHERE id=?",
          now,
          command.asked ? 1 : 0,
          command.areaId,
        );
        return {};
      case "convert-task": {
        const area = this.get(
          "SELECT * FROM work_areas WHERE id=?",
          command.areaId,
        );
        if (!area || area.type !== "task")
          throw new WorkError("Only a task can become a project.");
        if (command.convert)
          // Same record, same id: history, links, objective and tracker stay.
          this.run(
            "UPDATE work_areas SET type='project',converted_from='task',declined_shape_json=NULL WHERE id=?",
            command.areaId,
          );
        else
          this.run(
            "UPDATE work_areas SET declined_shape_json=? WHERE id=?",
            JSON.stringify({
              milestones: area.milestones,
              people: area.people,
              steps: area.steps,
            }),
            command.areaId,
          );
        return { ref: command.areaId };
      }
      case "relate-areas": {
        const from = this.groupOf(command.fromId);
        const to = this.groupOf(command.toId);
        if (from !== to && !this.granted(from, to))
          throw new WorkError(
            "These belong to different groups. Linking them needs your permission first.",
            { reason: "cross_group" },
          );
        this.run(
          "INSERT OR IGNORE INTO work_area_relations(from_id,to_id,kind) VALUES (?,?,?)",
          command.fromId,
          command.toId,
          command.relation,
        );
        return {};
      }
      case "save-record": {
        this.requireGroup(command.groupId);
        const id = randomUUID();
        this.run(
          "INSERT INTO work_records(id,group_id,type,title,body,linkage,created_at,updated_at) VALUES (?,?,?,?,?,'unresolved',?,?)",
          id,
          command.groupId,
          command.type,
          this.clean(command.title),
          this.clean(command.body),
          now,
          now,
        );
        return { ref: id };
      }
      case "link-record": {
        const record = this.get(
          "SELECT * FROM work_records WHERE id=?",
          command.recordId,
        );
        if (!record) throw new WorkError("That record no longer exists.");
        const groupId = (record.group_id as string | null) ?? null;
        const areas = this.areas();
        const current = this.all(
          "SELECT work_area_id FROM work_record_links WHERE record_id=?",
          command.recordId,
        ).map((row) => String(row.work_area_id));
        const outcome = linkRecord(
          { groupId, links: current },
          command.choice === "link"
            ? { choice: "link", workAreaIds: command.workAreaIds }
            : { choice: command.choice },
          areas,
          areas
            .filter((area) =>
              this.granted(groupId, area.groupId, command.recordId),
            )
            .map((area) => area.id),
        );
        if (!outcome.ok) {
          if (outcome.reason === "cross_group")
            throw new WorkError(
              "That work is in another group. Using this record there needs your permission.",
              { reason: "cross_group", workAreaIds: outcome.workAreaIds },
            );
          throw new WorkError("Choose where this record belongs.");
        }
        this.run(
          "DELETE FROM work_record_links WHERE record_id=?",
          command.recordId,
        );
        for (const areaId of outcome.links)
          this.run(
            "INSERT INTO work_record_links(record_id,work_area_id) VALUES (?,?)",
            command.recordId,
            areaId,
          );
        this.run(
          "UPDATE work_records SET linkage=?,updated_at=? WHERE id=?",
          outcome.linkage,
          now,
          command.recordId,
        );
        return { ref: command.recordId, step: { linkage: outcome.linkage } };
      }
      case "grant-cross-group": {
        this.requireGroup(command.sourceGroupId);
        this.requireGroup(command.targetGroupId);
        if (command.sourceGroupId === command.targetGroupId)
          throw new WorkError("Both sides are the same group.");
        const id = randomUUID();
        this.run(
          "INSERT INTO cross_group_grants(id,source_group_id,target_group_id,information,purpose,target_ref,created_at) VALUES (?,?,?,?,?,?,?)",
          id,
          command.sourceGroupId,
          command.targetGroupId,
          this.clean(command.information),
          this.clean(command.purpose),
          command.targetRef,
          now,
        );
        return { ref: id };
      }
      case "revoke-grant":
        this.run(
          "UPDATE cross_group_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
          now,
          command.grantId,
        );
        return {};
      case "save-objective": {
        this.requireGroup(command.groupId);
        const id = command.objectiveId ?? randomUUID();
        // One shared objective record; links stay inside its own group.
        for (const areaId of command.workAreaIds)
          if (this.groupOf(areaId) !== command.groupId)
            throw new WorkError(
              "An objective links only to work in its own group.",
              { reason: "cross_group" },
            );
        this.run(
          "INSERT INTO work_objectives(id,group_id,metric,baseline,target,current,evidence_date,review_date,conflict) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metric=excluded.metric,baseline=excluded.baseline,target=excluded.target,current=excluded.current,evidence_date=excluded.evidence_date,review_date=excluded.review_date,conflict=excluded.conflict",
          id,
          command.groupId,
          this.clean(command.metric),
          command.baseline,
          command.target,
          command.current,
          command.evidenceDate,
          command.reviewDate,
          command.conflict ? 1 : 0,
        );
        this.run("DELETE FROM work_objective_links WHERE objective_id=?", id);
        for (const areaId of command.workAreaIds)
          this.run(
            "INSERT INTO work_objective_links(objective_id,work_area_id) VALUES (?,?)",
            id,
            areaId,
          );
        return { ref: id };
      }
      case "add-permission": {
        this.requireGroup(command.groupId);
        const gate = gateFor({
          action: command.permit as never,
          destination: command.destination,
          groupId: command.groupId,
        });
        // Standing permissions can never cover one of the three gates.
        if (gate)
          throw new WorkError(
            `${gateLabels[gate]} always needs your approval, so it cannot be a standing permission.`,
          );
        const id = randomUUID();
        this.run(
          "INSERT INTO standing_permissions(id,group_id,destination,action,created_at) VALUES (?,?,?,?,?)",
          id,
          command.groupId,
          command.destination,
          command.permit,
          now,
        );
        return { ref: id };
      }
      case "revoke-permission":
        this.run(
          "UPDATE standing_permissions SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
          now,
          command.permissionId,
        );
        return {};
      case "rule-case": {
        this.requireGroup(command.groupId);
        this.run(
          "INSERT OR IGNORE INTO rule_cases(group_id,situation,resolution,event_id,created_at) VALUES (?,?,?,?,?)",
          command.groupId,
          command.situation,
          this.clean(command.resolution),
          command.eventId,
          now,
        );
        const applied = this.get(
          "SELECT id FROM learned_rules WHERE group_id=? AND situation=? AND state='active'",
          command.groupId,
          command.situation,
        );
        if (applied)
          this.run(
            "UPDATE learned_rules SET uses=uses+1 WHERE id=?",
            applied.id,
          );
        return { step: { appliedRule: !!applied } };
      }
      case "decide-rule": {
        this.requireGroup(command.groupId);
        const state =
          command.choice === "remember"
            ? "active"
            : command.choice === "never"
              ? "never"
              : "declined";
        const seen = this.get(
          "SELECT count(*) AS n FROM rule_cases WHERE group_id=? AND situation=?",
          command.groupId,
          command.situation,
        );
        // For a declined rule, `uses` remembers how many cases had been seen.
        this.run(
          "INSERT INTO learned_rules(id,group_id,situation,resolution,state,uses,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(group_id,situation) DO UPDATE SET resolution=excluded.resolution,state=excluded.state,uses=excluded.uses",
          randomUUID(),
          command.groupId,
          command.situation,
          this.clean(command.resolution),
          state,
          state === "declined" ? Number(seen?.n ?? 0) : 0,
          now,
        );
        return {};
      }
      case "revoke-rule":
        this.run(
          "UPDATE learned_rules SET state='revoked' WHERE id=?",
          command.ruleId,
        );
        return {};
      case "propose-plan": {
        const groupId = command.workAreaId
          ? this.groupOf(command.workAreaId)
          : command.groupId;
        const id = randomUUID();
        this.run(
          "INSERT INTO work_plans(id,group_id,work_area_id,kind,destination,summary,items_json,state,created_at) VALUES (?,?,?,?,?,?,?,'proposed',?)",
          id,
          groupId,
          command.workAreaId,
          command.planKind,
          command.destination,
          this.clean(command.summary),
          JSON.stringify(command.items),
          now,
        );
        this.attend({
          kind: "approval",
          groupId,
          workAreaId: command.workAreaId,
          title:
            command.summary ||
            `${command.items.length} changes ready for review`,
          detail: "Proposed changes await your approval",
          ref: "plan:" + id,
        });
        return { ref: id };
      }
      case "update-plan": {
        const plan = this.get(
          "SELECT state FROM work_plans WHERE id=?",
          command.planId,
        );
        if (!plan) throw new WorkError("That plan no longer exists.");
        if (plan.state === "published")
          throw new WorkError("That plan has already been published.");
        // Changing a plan after approval sends it back for review.
        this.run(
          "UPDATE work_plans SET items_json=?,state='proposed',approved_json=NULL,approved_at=NULL WHERE id=?",
          JSON.stringify(command.items),
          command.planId,
        );
        return { ref: command.planId };
      }
      case "approve-plan":
        return this.approvePlan(command.planId, command.fingerprint);
      case "request-changes": {
        this.run(
          "UPDATE work_plans SET state='changes_requested' WHERE id=? AND state IN ('proposed','approved')",
          command.planId,
        );
        this.closeAttention("plan:" + command.planId);
        return { ref: command.planId };
      }
      case "record-results":
        return this.recordResults(command.planId, command.results);
      case "attention":
        return {
          ref: this.attend({
            kind: command.attentionKind,
            groupId: command.workAreaId
              ? this.groupOf(command.workAreaId)
              : command.groupId,
            workAreaId: command.workAreaId,
            title: command.title,
            detail: command.detail,
            ref: command.ref,
            options: command.options,
          }),
        };
      case "resolve-attention": {
        const item = this.get(
          "SELECT * FROM work_attention WHERE id=?",
          command.attentionId,
        );
        if (!item) throw new WorkError("That item is no longer open.");
        if (command.resolution === "snooze") {
          this.run(
            "UPDATE work_attention SET state='snoozed',snoozed_until=? WHERE id=?",
            new Date(this.now().getTime() + 3_600_000).toISOString(),
            command.attentionId,
          );
          return {};
        }
        // An approval is never completed from here: it has its own review.
        if (
          item.kind === "approval" &&
          String(item.ref ?? "").startsWith("plan:")
        )
          throw new WorkError(
            "Open the review to approve or request changes. Marking it done does not approve it.",
          );
        if (command.resolution === "answer" && !command.answer?.trim())
          throw new WorkError("Write an answer first.");
        // Answering a memory question from the Island settles the discrepancy.
        if (String(item.ref ?? "").startsWith("claim:") && command.answer) {
          const claim = this.get(
            "SELECT value FROM memory_claims WHERE id=?",
            String(item.ref).slice(6),
          );
          return this.apply({
            version: 1,
            kind: "work",
            action: "resolve-claim",
            attentionId: command.attentionId,
            keep:
              claim && String(claim.value) === command.answer.trim()
                ? "incoming"
                : "current",
          });
        }
        this.run(
          "UPDATE work_attention SET state='done',answer=?,resolved_at=? WHERE id=?",
          command.answer ? this.clean(command.answer) : null,
          now,
          command.attentionId,
        );
        if (item.kind === "offer" && command.resolution === "accept")
          // Accepting the offer only drafts. Nothing is sent.
          this.activity({
            groupId: (item.group_id as string | null) ?? null,
            workAreaId: (item.work_area_id as string | null) ?? null,
            text: `Drafting: ${String(item.title)}`,
            state: "running",
            ref: "offer:" + command.attentionId,
          });
        return { ref: command.attentionId };
      }
      case "save-rfp": {
        let areaId = command.areaId;
        if (!areaId) {
          areaId = this.createArea({
            groupId: command.groupId,
            type: "rfp",
            name: command.name,
            ...(command.deadline ? { dueAt: command.deadline } : {}),
            ...(command.client ? { client: command.client } : {}),
          }).id;
        } else
          this.run(
            "UPDATE work_areas SET name=?,due_at=?,client=?,last_context_at=? WHERE id=? AND type='rfp'",
            this.clean(command.name),
            command.deadline,
            command.client ? this.clean(command.client) : null,
            now,
            areaId,
          );
        const text = (value: string | null) =>
          value ? this.clean(value) : null;
        this.run(
          "INSERT INTO rfps(work_area_id,client,stage,deadline,response_owner,account_owner,presales) VALUES (?,?,'received',?,?,?,?) ON CONFLICT(work_area_id) DO UPDATE SET client=excluded.client,deadline=excluded.deadline,response_owner=excluded.response_owner,account_owner=excluded.account_owner,presales=excluded.presales",
          areaId,
          this.clean(command.client),
          command.deadline,
          text(command.responseOwner),
          text(command.accountOwner),
          text(command.presales),
        );
        return { ref: areaId };
      }
      case "move-rfp": {
        const rfp = this.get(
          "SELECT * FROM rfps WHERE work_area_id=?",
          command.areaId,
        );
        if (!rfp) throw new WorkError("That RFP no longer exists.");
        if (command.stage === "handed_to_delivery" && !rfp.delivery_project_id)
          throw new WorkError(
            "An RFP is handed to delivery once the proposal is signed and the BRD is approved.",
          );
        this.run(
          "UPDATE rfps SET stage=?,loss_reason=? WHERE work_area_id=?",
          command.stage,
          command.stage === "lost" && command.lossReason
            ? this.clean(command.lossReason)
            : command.stage === "lost"
              ? rfp.loss_reason
              : null,
          command.areaId,
        );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id=?",
          now,
          command.areaId,
        );
        return {};
      }
      case "rfp-readiness":
        this.run(
          "UPDATE rfps SET proposal_signed=?,brd_approved=? WHERE work_area_id=?",
          command.proposalSigned ? 1 : 0,
          command.brdApproved ? 1 : 0,
          command.areaId,
        );
        return {};
      case "handoff-rfp":
        return this.handoff(command.areaId);
      case "save-roadmap-item": {
        if (
          !this.get("SELECT 1 FROM work_areas WHERE id=?", command.workAreaId)
        )
          throw new WorkError("That work area no longer exists.");
        const existing = command.itemId
          ? this.get("SELECT * FROM roadmap_items WHERE id=?", command.itemId)
          : undefined;
        if (existing && bool(existing.committed))
          throw new WorkError(
            "This item is on the committed roadmap. Changing it needs your approval.",
          );
        const id = existing ? String(existing.id) : randomUUID();
        const position = existing
          ? Number(existing.position)
          : Number(
              this.get(
                "SELECT count(*) AS n FROM roadmap_items WHERE horizon=?",
                command.horizon,
              )?.n ?? 0,
            );
        this.run(
          "INSERT INTO roadmap_items(id,work_area_id,title,horizon,position,estimated,release,start,end,reach,impact,confidence,effort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,horizon=excluded.horizon,estimated=excluded.estimated,release=excluded.release,start=excluded.start,end=excluded.end,reach=excluded.reach,impact=excluded.impact,confidence=excluded.confidence,effort=excluded.effort",
          id,
          command.workAreaId,
          this.clean(command.title),
          command.horizon,
          position,
          command.estimated ? 1 : 0,
          command.release,
          command.start,
          command.end,
          command.reach,
          command.impact,
          command.confidence,
          command.effort,
        );
        return { ref: id };
      }
      case "move-roadmap-item": {
        const items = this.roadmap();
        const moving = items.find((item) => item.id === command.itemId);
        if (!moving) throw new WorkError("That roadmap item no longer exists.");
        const outcome = resequence(items, {
          id: command.itemId,
          horizon: command.horizon,
          index: command.index,
        });
        if (outcome.apply) {
          this.writeRoadmap(outcome.items);
          return { ref: command.itemId };
        }
        const groupId = this.groupOf(moving.workAreaId);
        const planId = randomUUID();
        const target = outcome.proposal.find(
          (item) => item.id === command.itemId,
        )!;
        this.run(
          "INSERT INTO work_plans(id,group_id,work_area_id,kind,destination,summary,items_json,state,created_at) VALUES (?,?,?,'roadmap','amun',?,?,'proposed',?)",
          planId,
          groupId,
          moving.workAreaId,
          `Move "${moving.title}" to ${target.horizon}`,
          JSON.stringify([
            {
              id: command.itemId,
              summary: `${moving.title}: ${moving.horizon} → ${target.horizon}`,
              fields: { horizon: target.horizon, position: target.position },
            },
          ]),
          now,
        );
        this.attend({
          kind: "approval",
          groupId,
          workAreaId: moving.workAreaId,
          title: `Committed roadmap change: ${moving.title}`,
          detail: outcome.reason,
          ref: "plan:" + planId,
        });
        return {
          ref: planId,
          message: outcome.reason,
          step: { needsApproval: true, planId },
        };
      }
      case "save-sprint": {
        if (
          !this.get("SELECT 1 FROM work_areas WHERE id=?", command.workAreaId)
        )
          throw new WorkError("That work area no longer exists.");
        if (Date.parse(command.end) < Date.parse(command.start))
          throw new WorkError("A sprint cannot end before it starts.");
        const id = command.sprintId ?? randomUUID();
        this.run(
          "INSERT INTO work_sprints(id,work_area_id,name,team,start,end,goal,draft,capacity,stories_json,out_json,total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,team=excluded.team,start=excluded.start,end=excluded.end,goal=excluded.goal,draft=excluded.draft,capacity=excluded.capacity,stories_json=excluded.stories_json,out_json=excluded.out_json,total=excluded.total",
          id,
          command.workAreaId,
          this.clean(command.name),
          command.team ? this.clean(command.team) : null,
          command.start,
          command.end,
          this.clean(command.goal),
          command.draft ? 1 : 0,
          command.capacity,
          JSON.stringify(command.stories),
          JSON.stringify(command.out),
          command.stories.length,
        );
        return { ref: id };
      }
      case "move-sprint-story": {
        const sprint = this.get(
          "SELECT * FROM work_sprints WHERE id=?",
          command.sprintId,
        );
        if (!sprint) throw new WorkError("That sprint no longer exists.");
        if (!bool(sprint.draft))
          throw new WorkError(
            "This sprint is committed. Propose the change and approve it to update Azure DevOps.",
          );
        const next = moveStory(
          {
            goal: String(sprint.goal),
            capacity: (sprint.capacity as number | null) ?? null,
            stories: list(sprint.stories_json),
            out: list(sprint.out_json),
          },
          command.storyId,
          {
            list: command.list,
            ...(command.owner !== undefined ? { owner: command.owner } : {}),
          },
        );
        this.run(
          "UPDATE work_sprints SET stories_json=?,out_json=?,total=? WHERE id=?",
          JSON.stringify(next.stories),
          JSON.stringify(next.out),
          next.stories.length,
          command.sprintId,
        );
        return { ref: command.sprintId };
      }
      case "calendar-exception":
        this.run(
          "INSERT INTO calendar_exceptions(date,label) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET label=excluded.label",
          command.date,
          this.clean(command.label),
        );
        return {};
      case "save-output": {
        this.requireGroup(command.groupId);
        for (const areaId of command.workAreaIds)
          if (this.groupOf(areaId) !== command.groupId)
            throw new WorkError(
              "An output is filed with work in its own group.",
              { reason: "cross_group" },
            );
        const id = command.outputId ?? randomUUID();
        this.run(
          "INSERT INTO library_outputs(id,group_id,type,title,body,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,status=excluded.status,type=excluded.type,updated_at=excluded.updated_at",
          id,
          command.groupId,
          command.type,
          this.clean(command.title),
          this.clean(command.body),
          command.status,
          now,
          now,
        );
        this.run("DELETE FROM library_output_links WHERE output_id=?", id);
        for (const areaId of command.workAreaIds)
          this.run(
            "INSERT INTO library_output_links(output_id,work_area_id) VALUES (?,?)",
            id,
            areaId,
          );
        return { ref: id };
      }
      case "record-decision":
        return { ref: this.decide(command) };
      case "scope-answer": {
        const groupId = this.groupOf(command.workAreaId);
        this.run(
          "INSERT INTO scope_answers(work_area_id,item,answer,created_at) VALUES (?,?,?,?) ON CONFLICT(work_area_id,item) DO UPDATE SET answer=excluded.answer",
          command.workAreaId,
          command.item,
          command.answer,
          now,
        );
        if (command.answer === "add_anyway")
          // An honest trail: the user's instruction is not a client approval.
          this.decide({
            groupId,
            workAreaId: command.workAreaId,
            what: `Add "${command.item}" outside the approved BRD`,
            options: ["Add anyway", "Link a change request", "Keep out"],
            outcome:
              "Added as an exception · no approved change request · deadline unchanged",
            decidedBy: "you",
            affected: [command.item],
            source: "exception",
          });
        return {
          step: {
            tag: command.answer === "add_anyway" ? "Exception · no CR" : null,
          },
        };
      }
      case "add-agent": {
        const role = roleFrom(command.description);
        if (
          this.get("SELECT 1 FROM work_agents WHERE lower(role)=lower(?)", role)
        )
          throw new WorkError(`You already have a ${role}.`);
        if (!this.get("SELECT 1 FROM work_agents WHERE kind='lead'"))
          this.run(
            "INSERT INTO work_agents(id,role,kind,state,created_at) VALUES ('firstmate','Firstmate','lead','idle',?)",
            now,
          );
        const id = randomUUID();
        this.run(
          "INSERT INTO work_agents(id,role,kind,launcher_id,state,now_doing,created_at) VALUES (?,?,?,'firstmate','idle',?,?)",
          id,
          this.clean(role),
          command.always ? "always_on" : "temporary",
          null,
          now,
        );
        return { ref: id };
      }
      case "toggle-agent":
        this.run(
          "UPDATE work_agents SET enabled=? WHERE id=? AND kind<>'lead'",
          command.enabled ? 1 : 0,
          command.agentId,
        );
        return {};
      case "activity": {
        const groupId = command.workAreaId
          ? this.groupOf(command.workAreaId)
          : command.groupId;
        if (command.activityId) {
          this.run(
            "UPDATE work_activity SET state=?,progress=?,text=? WHERE id=?",
            command.state,
            command.progress,
            this.clean(command.text),
            command.activityId,
          );
        }
        const id =
          command.activityId ??
          this.activity({
            groupId,
            workAreaId: command.workAreaId,
            text: command.text,
            state: command.state,
            ref: command.ref,
            progress: command.progress,
          });
        // Each delegated task gets its own attention item when it ends (Q74).
        if (command.state !== "running" && !command.silent)
          this.attend({
            kind: command.state === "failed" ? "failure" : "result",
            groupId,
            workAreaId: command.workAreaId,
            title: command.text,
            detail:
              command.state === "failed"
                ? "This did not finish"
                : "Ready for you to look at",
            ref: "activity:" + id,
          });
        return { ref: id };
      }
      case "council-session": {
        const groupId = command.workAreaId
          ? this.groupOf(command.workAreaId)
          : command.groupId;
        const id = command.sessionId ?? randomUUID();
        const before = this.get(
          "SELECT state FROM council_sessions WHERE id=?",
          id,
        );
        this.run(
          "INSERT INTO council_sessions(id,decision,group_id,work_area_id,mode,state,recommendation,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,recommendation=excluded.recommendation",
          id,
          this.clean(command.decision),
          groupId,
          command.workAreaId,
          command.mode,
          command.state,
          command.recommendation ? this.clean(command.recommendation) : null,
          now,
        );
        if (command.state === "finished" && before?.state !== "finished") {
          // Report → Library; actionable recommendation → Decisions for
          // review. A verdict never changes roadmap, backlog or tickets.
          const output = randomUUID();
          this.run(
            "INSERT INTO library_outputs(id,group_id,type,title,body,status,created_at,updated_at) VALUES (?,?,'council_report',?,?,'Advisory',?,?)",
            output,
            groupId,
            this.clean(`Council · ${command.decision}`),
            command.recommendation ? this.clean(command.recommendation) : "",
            now,
            now,
          );
          if (command.workAreaId)
            this.run(
              "INSERT INTO library_output_links(output_id,work_area_id) VALUES (?,?)",
              output,
              command.workAreaId,
            );
          if (command.recommendation)
            this.decide({
              groupId,
              workAreaId: command.workAreaId,
              what: command.decision,
              options: [command.recommendation],
              outcome: null,
              decidedBy: null,
              affected: [],
              source: "council",
            });
        }
        return { ref: id };
      }
      case "save-finding": {
        const record = this.get(
          "SELECT * FROM work_records WHERE id=?",
          command.recordId,
        );
        if (!record) throw new WorkError("That record no longer exists.");
        const groupId = (record.group_id as string | null) ?? null;
        // A finding is proposed only to work in the record's own group, or
        // where the user has already allowed this record to be used.
        for (const areaId of command.workAreaIds) {
          const target = this.groupOf(areaId);
          if (
            target !== groupId &&
            !this.granted(groupId, target, command.recordId)
          )
            throw new WorkError(
              "That work is in another group. Using this record there needs your permission.",
              { reason: "cross_group", workAreaIds: [areaId] },
            );
        }
        const id = randomUUID();
        this.run(
          "INSERT INTO findings(id,record_id,text,created_at) VALUES (?,?,?,?)",
          id,
          command.recordId,
          this.clean(command.text),
          now,
        );
        for (const areaId of command.workAreaIds) {
          const area = this.get("SELECT * FROM work_areas WHERE id=?", areaId)!;
          const rule =
            this.get(
              "SELECT tracker FROM routing_rules WHERE group_id=? AND condition=?",
              area.group_id,
              area.type === "project" ? "delivery" : area.type,
            ) ??
            this.get(
              "SELECT tracker FROM routing_rules WHERE group_id=? AND condition IS NULL",
              area.group_id,
            );
          const planId = randomUUID();
          this.run(
            "INSERT INTO work_plans(id,group_id,work_area_id,kind,destination,summary,items_json,state,created_at) VALUES (?,?,?,'stories',?,?,?,'proposed',?)",
            planId,
            area.group_id,
            areaId,
            String(rule?.tracker ?? "amun"),
            this.clean(`Add to ${String(area.name)}: ${command.text}`),
            JSON.stringify([
              {
                id,
                summary: this.clean(command.text),
                fields: { source: String(record.title) },
              },
            ]),
            now,
          );
          this.run(
            "INSERT INTO finding_plans(finding_id,work_area_id,plan_id) VALUES (?,?,?)",
            id,
            areaId,
            planId,
          );
          // Proposed only: nothing reaches a backlog or roadmap unapproved.
          this.attend({
            kind: "approval",
            groupId: (area.group_id as string | null) ?? null,
            workAreaId: areaId,
            title: `A finding for ${String(area.name)}`,
            detail: command.text,
            ref: "plan:" + planId,
          });
        }
        return { ref: id };
      }
      case "defer-finding": {
        const link = this.get(
          "SELECT plan_id FROM finding_plans WHERE finding_id=? AND work_area_id=?",
          command.findingId,
          command.workAreaId,
        );
        if (!link) throw new WorkError("That finding is not proposed there.");
        this.run(
          "UPDATE work_plans SET state='changes_requested' WHERE id=? AND state='proposed'",
          link.plan_id,
        );
        this.run(
          "UPDATE finding_plans SET deferred=1 WHERE finding_id=? AND work_area_id=?",
          command.findingId,
          command.workAreaId,
        );
        this.closeAttention("plan:" + String(link.plan_id));
        return {};
      }
      case "external-change": {
        const groupId = this.groupOf(command.workAreaId);
        const view = externalChange(command);
        // Observed, never reverted: Azure DevOps stays official for its fields.
        this.activity({
          groupId,
          workAreaId: command.workAreaId,
          text: `${command.itemId}: ${view.activity}`,
          state: "finished",
          ref: "external:" + command.itemId,
        });
        if (command.sprintId)
          this.run(
            "UPDATE work_sprints SET changed_in_ado=1 WHERE id=? AND work_area_id=?",
            command.sprintId,
            command.workAreaId,
          );
        if (view.attention)
          this.attend({
            kind: "risk",
            groupId,
            workAreaId: command.workAreaId,
            title: `${command.itemId} changed in Azure DevOps`,
            detail: view.activity,
            ref: "external:" + command.itemId,
            options: view.attention.overflow,
          });
        return { step: { flag: view.flag, attention: !!view.attention } };
      }
      case "record-claim": {
        this.requireGroup(command.groupId);
        const current = this.get(
          "SELECT * FROM memory_claims WHERE ifnull(group_id,'')=ifnull(?,'') AND key=? AND state='current'",
          command.groupId,
          command.key,
        );
        const incoming = {
          key: command.key,
          value: this.clean(command.value),
          source: this.clean(command.source),
          date: command.observedAt,
          confirmed: command.confirmed,
        };
        const step = memoryUpdate(
          current
            ? {
                key: String(current.key),
                value: String(current.value),
                source: String(current.source),
                date: String(current.observed_at),
                confirmed: bool(current.confirmed),
              }
            : null,
          incoming,
        );
        if (current && String(current.value) === incoming.value)
          return { ref: String(current.id), step: { step: "unchanged" } };
        const id = randomUUID();
        const insert = (state: string) =>
          this.run(
            "INSERT INTO memory_claims(id,group_id,key,value,source,observed_at,confirmed,state,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            id,
            command.groupId,
            incoming.key,
            incoming.value,
            incoming.source,
            incoming.date,
            incoming.confirmed ? 1 : 0,
            state,
            now,
          );
        if (step.step === "ask") {
          // The discrepancy stays open; nothing is overwritten or assumed.
          insert("disputed");
          this.attend({
            kind: "question",
            groupId: command.groupId,
            workAreaId: null,
            title: step.text,
            detail: "The earlier fact is kept until you say which is right.",
            ref: "claim:" + id,
            options: [incoming.value, String(current!.value)],
          });
          return { ref: id, step: { step: "ask" } };
        }
        insert("current");
        if (current)
          // History is kept: the older fact is superseded, not deleted.
          this.run(
            "UPDATE memory_claims SET state='superseded',superseded_by=? WHERE id=?",
            id,
            current.id,
          );
        return { ref: id, step: { step: "record" } };
      }
      case "resolve-claim": {
        const item = this.get(
          "SELECT * FROM work_attention WHERE id=?",
          command.attentionId,
        );
        const claimId = String(item?.ref ?? "").startsWith("claim:")
          ? String(item!.ref).slice(6)
          : null;
        const disputed = claimId
          ? this.get(
              "SELECT * FROM memory_claims WHERE id=? AND state='disputed'",
              claimId,
            )
          : undefined;
        if (!item || !disputed)
          throw new WorkError("That question has already been settled.");
        if (command.keep === "incoming") {
          this.run(
            "UPDATE memory_claims SET state='superseded',superseded_by=? WHERE ifnull(group_id,'')=ifnull(?,'') AND key=? AND state='current'",
            claimId,
            disputed.group_id,
            disputed.key,
          );
          this.run(
            "UPDATE memory_claims SET state='current',confirmed=1 WHERE id=?",
            claimId,
          );
        } else
          this.run(
            "UPDATE memory_claims SET state='superseded' WHERE id=?",
            claimId,
          );
        this.run(
          "UPDATE work_attention SET state='done',answer=?,resolved_at=? WHERE id=?",
          command.keep === "incoming"
            ? String(disputed.value)
            : "Kept the earlier fact",
          now,
          command.attentionId,
        );
        return {};
      }
      case "message": {
        if (
          !this.get("SELECT 1 FROM work_areas WHERE id=?", command.workAreaId)
        )
          throw new WorkError("That work area no longer exists.");
        const id = randomUUID();
        this.run(
          "INSERT INTO work_messages(id,work_area_id,role,text,card_json,created_at) VALUES (?,?,?,?,?,?)",
          id,
          command.workAreaId,
          command.role,
          this.clean(command.text),
          command.card === null ? null : JSON.stringify(command.card),
          now,
        );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id=?",
          now,
          command.workAreaId,
        );
        return { ref: id };
      }
    }
  }

  private addGroup(raw: string) {
    const name = this.clean(raw);
    const existing = this.get(
      "SELECT id FROM work_groups WHERE lower(name)=lower(?)",
      name,
    );
    if (existing) return String(existing.id);
    const id = randomUUID();
    const position = Number(
      this.get("SELECT count(*) AS n FROM work_groups")?.n ?? 0,
    );
    this.run(
      "INSERT INTO work_groups(id,name,position,created_at) VALUES (?,?,?,?)",
      id,
      name,
      position,
      this.stamp(),
    );
    return id;
  }
  private setRoute(groupId: string, condition: string | null, tracker: string) {
    this.run(
      "DELETE FROM routing_rules WHERE group_id=? AND ifnull(condition,'')=ifnull(?,'')",
      groupId,
      condition,
    );
    this.run(
      "INSERT INTO routing_rules(id,group_id,condition,tracker,created_at) VALUES (?,?,?,?,?)",
      randomUUID(),
      groupId,
      condition,
      tracker,
      this.stamp(),
    );
  }
  /** A cross-group grant is specific: source → target, optionally one record or area. */
  private granted(source: string | null, target: string | null, ref?: string) {
    if (source === target) return false;
    if (!source || !target) return false;
    return !!this.get(
      "SELECT 1 FROM cross_group_grants WHERE source_group_id=? AND target_group_id=? AND revoked_at IS NULL AND (target_ref IS NULL OR target_ref=?)",
      source,
      target,
      ref ?? null,
    );
  }
  private closeAttention(ref: string) {
    this.run(
      "UPDATE work_attention SET state='done',resolved_at=? WHERE ref=? AND state<>'done'",
      this.stamp(),
      ref,
    );
  }
  private decide(input: {
    decisionId?: string | undefined;
    groupId: string | null;
    workAreaId: string | null;
    what: string;
    options: string[];
    outcome: string | null;
    decidedBy: string | null;
    affected: string[];
    source: string;
  }) {
    const groupId = input.workAreaId
      ? this.groupOf(input.workAreaId)
      : input.groupId;
    const id = input.decisionId ?? randomUUID();
    const now = this.stamp();
    this.run(
      "INSERT INTO decision_log(id,group_id,work_area_id,what,options_json,decided_by,decided_at,outcome,affected_json,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET outcome=excluded.outcome,decided_by=excluded.decided_by,decided_at=excluded.decided_at,affected_json=excluded.affected_json",
      id,
      groupId,
      input.workAreaId,
      this.clean(input.what),
      JSON.stringify(input.options),
      input.outcome === null ? null : (input.decidedBy ?? "you"),
      input.outcome === null ? null : now,
      input.outcome === null ? null : this.clean(input.outcome),
      JSON.stringify(input.affected),
      input.source,
      now,
    );
    return id;
  }

  private intake(command: Extract<WorkCommand, { action: "intake" }>) {
    const setup = this.setup();
    const groups = this.all(
      "SELECT id,name FROM work_groups ORDER BY position",
    ).map((row) => ({ id: String(row.id), name: String(row.name) }));
    const groupId = command.groupId ?? setup.activeGroupId;
    const step = intake({
      text: command.text,
      fileNames: command.fileNames,
      groupId,
      groups,
      areas: this.areas(),
    });
    const resolvedGroup =
      groupId ?? (groups.length === 1 ? groups[0]!.id : null);
    const title = titleFrom(command.text, command.fileNames);
    if (step.step === "save_record") {
      const id = randomUUID();
      const now = this.stamp();
      this.run(
        "INSERT INTO work_records(id,group_id,type,title,body,linkage,created_at,updated_at) VALUES (?,?,?,?,?,'unresolved',?,?)",
        id,
        resolvedGroup,
        step.type,
        this.clean(title),
        this.clean(command.text),
        now,
        now,
      );
      return {
        ref: id,
        step: { ...step, recordId: id, groupId: resolvedGroup },
      };
    }
    if (step.step === "file_work") {
      this.run(
        "UPDATE work_areas SET last_context_at=? WHERE id=?",
        this.stamp(),
        step.area.id,
      );
      return {
        ref: step.area.id,
        step: { step: "file_work", areaId: step.area.id, name: step.area.name },
      };
    }
    if (step.step === "choose_work")
      return {
        step: {
          step: "choose_work",
          type: step.type,
          title,
          groupId: resolvedGroup,
          options: step.options.map((area) => ({
            id: area.id,
            name: area.name,
          })),
        },
      };
    if (step.step === "unreadable")
      return {
        ok: false,
        message:
          "I could not read that. Your file is kept; try pasting the text or another format.",
        step,
      };
    return { step: { ...step, title, groupId: resolvedGroup } };
  }

  private approvePlan(planId: string, fingerprint: string) {
    const row = this.get("SELECT * FROM work_plans WHERE id=?", planId);
    if (!row) throw new WorkError("That plan no longer exists.");
    if (row.state !== "proposed")
      throw new WorkError(
        row.state === "changes_requested"
          ? "You asked for changes to this plan. It needs a new proposal."
          : "This plan has already been approved.",
      );
    const current: Plan = {
      destination: String(row.destination),
      items: list(row.items_json),
    };
    // The approval covers exactly what was on screen. If anything moved
    // after the review opened, nothing is approved.
    if (planFingerprint(current) !== fingerprint)
      throw new WorkError(
        "This plan changed after you opened it. Review the current version before approving.",
        { reason: "changed" },
      );
    const now = this.stamp();
    this.run(
      "UPDATE work_plans SET state='approved',approved_json=?,approved_at=? WHERE id=?",
      row.items_json,
      now,
      planId,
    );
    this.closeAttention("plan:" + planId);
    const groupId = (row.group_id as string | null) ?? null;
    const workAreaId = (row.work_area_id as string | null) ?? null;
    if (row.kind === "roadmap" && row.destination === "amun") {
      const items = this.roadmap();
      let next = items;
      for (const item of current.items) {
        const outcome = resequence(
          next.map((entry) =>
            entry.id === item.id ? { ...entry, committed: false } : entry,
          ),
          {
            id: item.id,
            horizon: item.fields.horizon as "now" | "next" | "later",
            index: Number(item.fields.position ?? 0),
          },
        );
        if (outcome.apply)
          next = outcome.items.map((entry) =>
            entry.id === item.id ? { ...entry, committed: true } : entry,
          );
      }
      this.writeRoadmap(next);
      this.run("UPDATE work_plans SET state='published' WHERE id=?", planId);
      this.decide({
        groupId,
        workAreaId,
        what: String(row.summary),
        options: [],
        outcome: "Approved",
        decidedBy: "you",
        affected: current.items.map((item) => item.id),
        source: "conversation",
      });
      this.activity({
        groupId,
        workAreaId,
        text: `Roadmap updated: ${String(row.summary)}`,
        state: "finished",
        ref: "plan:" + planId,
      });
      return { ref: planId, step: { published: true } };
    }
    this.activity({
      groupId,
      workAreaId,
      text: `Publishing ${current.items.length} approved ${current.items.length === 1 ? "change" : "changes"}`,
      state: "running",
      ref: "plan:" + planId,
    });
    return { ref: planId, step: { published: false } };
  }

  private recordResults(
    planId: string,
    results: {
      id: string;
      state: "created" | "failed" | "unknown";
      externalId?: string | undefined;
    }[],
  ) {
    const row = this.get("SELECT * FROM work_plans WHERE id=?", planId);
    if (!row) throw new WorkError("That plan no longer exists.");
    if (!["approved", "partial", "failed"].includes(String(row.state)))
      throw new WorkError("Only an approved plan can be published.");
    const approved: Plan = {
      destination: String(row.destination),
      items: list(row.approved_json),
    };
    // Only the approved operations may be reported as written.
    const outside = changeSinceApproval(approved, {
      destination: approved.destination,
      items: approved.items.filter((item) =>
        results.some((result) => result.id === item.id),
      ),
    });
    const known = new Set(approved.items.map((item) => item.id));
    if (outside.changed || results.some((result) => !known.has(result.id)))
      throw new WorkError("These results do not match the approved plan.");
    const merged = new Map<string, (typeof results)[number]>(
      (list(row.results_json) as typeof results).map((result) => [
        result.id,
        result,
      ]),
    );
    for (const result of results) {
      const before = merged.get(result.id);
      // A confirmed creation is never downgraded by a later retry report.
      if (before?.state === "created") continue;
      merged.set(result.id, result);
    }
    const all = [...merged.values()];
    const summary = writeSummary(all);
    const complete =
      summary.created === approved.items.length &&
      !summary.failed &&
      !summary.unknown;
    const state = complete
      ? "published"
      : summary.created
        ? "partial"
        : "failed";
    this.run(
      "UPDATE work_plans SET results_json=?,state=? WHERE id=?",
      JSON.stringify(all),
      state,
      planId,
    );
    const groupId = (row.group_id as string | null) ?? null;
    const workAreaId = (row.work_area_id as string | null) ?? null;
    this.run(
      "UPDATE work_activity SET state=? WHERE ref=? AND state='running'",
      complete ? "finished" : "failed",
      "plan:" + planId,
    );
    // Results with their IDs land in Activity, one row per item.
    for (const result of results) {
      const item = approved.items.find((entry) => entry.id === result.id)!;
      this.activity({
        groupId,
        workAreaId,
        text:
          result.state === "created"
            ? `Created ${result.externalId ? "#" + result.externalId + " " : ""}${item.summary}`
            : result.state === "failed"
              ? `Not created: ${item.summary}`
              : `Checking whether this was created: ${item.summary}`,
        state: result.state === "created" ? "finished" : "failed",
        ref: "plan:" + planId,
      });
    }
    this.closeAttention("failure:" + planId);
    if (!complete)
      this.attend({
        kind: "failure",
        groupId,
        workAreaId,
        title: "Some approved changes were not published",
        detail: summary.text,
        ref: "failure:" + planId,
        options: summary.button ? [summary.button] : [],
      });
    return { ref: planId, step: { ...summary, state } };
  }

  private handoff(areaId: string) {
    const row = this.get("SELECT * FROM rfps WHERE work_area_id=?", areaId);
    const area = this.get("SELECT * FROM work_areas WHERE id=?", areaId);
    if (!row || !area) throw new WorkError("That RFP no longer exists.");
    const step = rfpHandoff({
      id: areaId,
      client: String(row.client),
      stage: row.stage as never,
      deadline: null,
      responseOwner: null,
      accountOwner: null,
      presales: null,
      proposalSigned: bool(row.proposal_signed),
      brdApproved: bool(row.brd_approved),
      deliveryProjectId: (row.delivery_project_id as string | null) ?? null,
      lossReason: null,
    });
    if (step.step === "not_won")
      throw new WorkError("Only a won RFP can be handed to delivery.");
    if (step.step === "wait")
      throw new WorkError(
        step.pending === "signature"
          ? "Waiting for the signed proposal before handing to delivery."
          : "Waiting for the approved BRD before handing to delivery.",
        { pending: step.pending },
      );
    if (step.step === "reuse")
      return { ref: step.projectId, step: { reused: true } };
    const project = this.createArea({
      groupId: (area.group_id as string | null) ?? null,
      type: "project",
      name: `${String(area.name)} delivery`,
      purpose: `Client delivery for ${String(row.client) || String(area.name)}`,
      ...(row.client ? { client: String(row.client) } : {}),
    });
    this.run(
      "INSERT OR IGNORE INTO work_area_relations(from_id,to_id,kind) VALUES (?,?,'handoff')",
      areaId,
      project.id,
    );
    // The RFP record is kept; it only changes stage.
    this.run(
      "UPDATE rfps SET delivery_project_id=?,stage='handed_to_delivery' WHERE work_area_id=?",
      project.id,
      areaId,
    );
    return { ref: project.id, step: { reused: false } };
  }

  private writeRoadmap(items: WorkSnapshot["roadmap"]) {
    for (const item of items)
      this.run(
        "UPDATE roadmap_items SET horizon=?,position=?,committed=? WHERE id=?",
        item.horizon,
        item.position,
        item.committed ? 1 : 0,
        item.id,
      );
  }
  /** Marks roadmap items as committed once the owner has approved them. */
  commitRoadmap(ids: string[]) {
    for (const id of ids)
      this.run("UPDATE roadmap_items SET committed=1 WHERE id=?", id);
  }
}

export class WorkError extends Error {
  readonly step: Step;
  constructor(message: string, step: Step = null) {
    super(message);
    this.step = step;
  }
}
function stripUndefined<T extends object>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}
function titleFrom(text: string, files: string[]) {
  return nameFromRequest(text, files[0] ?? "Untitled");
}
/** "A researcher who reads competitor sites" → "Researcher". */
function roleFrom(description: string) {
  const words = description
    .trim()
    .replace(/^(add|create|i need|i want|give me)\s+/i, "")
    .replace(/^(an?|the)\s+/i, "")
    .split(/\s+(?:who|that|to|for|which)\s+/i)[0]!
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
  const role = words.replace(/[^\p{L}\p{N} -]/gu, "").trim() || "Agent";
  return role.charAt(0).toUpperCase() + role.slice(1);
}
