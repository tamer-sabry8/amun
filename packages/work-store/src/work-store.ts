import { draftBlockerNudge, recordNudgeAction } from "./blocker-nudge.ts";
// Storage and command handling for the UX rebuild model (migration 29).
// Decisions come from packages/domain/src/work; this file persists them.
import { randomUUID } from "node:crypto";
import type { Database } from "./sqlite.ts";
import { adoWorkItemOf } from "../../domain/src/ado-update.ts";
import { planItemKey, sameItem } from "./plan-publication.ts";
import { recordFirstMateReply } from "./first-mate-thread.ts";
import { WorkReminders } from "./work-reminders.ts";
import { searchContent } from "./content-search.ts";
import { agentCatalog } from "../../domain/src/work/agents.ts";
import { Redactor } from "./redaction.ts";
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
  groupMentioned,
  intake,
  linkRecord,
  nameFromRequest,
  type WorkArea,
  sameWorkName,
} from "../../domain/src/work/model.ts";
import {
  changeSinceApproval,
  gateFor,
  gateLabels,
  planFingerprint,
  ruleCandidate,
  failureDetail,
  writeSummary,
  type Plan,
} from "../../domain/src/work/permissions.ts";
import {
  externalChange,
  memoryUpdate,
  rfpHandoff,
} from "../../domain/src/work/flows.ts";
import { moveStory, resequence } from "../../domain/src/work/planning.ts";
import {
  parseProjectChecklist,
  releaseBodyIsLive,
} from "../../domain/src/work/release-launch.ts";
import {
  canProposeDelivered,
  storyGroup,
  storyStatusWords,
} from "../../domain/src/work/delivery-chain.ts";
import {
  readRequestBlocks,
  reportFingerprint,
  reportWords,
} from "../../domain/src/work/requests.ts";

type Row = Record<string, unknown>;
type Step = Parameters<typeof JSON.stringify>[0];
const bool = (value: unknown) => value === 1;
const list = (value: unknown) => JSON.parse(String(value ?? "[]"));
/** A chat's name from a line of text: one line, at most sixty characters. */
const chatTitle = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? line.slice(0, 60).trimEnd() + "…" : line;
};

/** A typed command on its own, such as "/model" or "/sprint refresh". */
const isTypedCommand = (text: string) =>
  /^\/[a-z][\w-]*(\s|$)/.test(text.trim());

/**
 * A deleted work is gone from everything Amun shows: the work itself, and
 * whatever was about it (its chat, plans, things waiting, activity, sprint,
 * roadmap items, RFP). Things that merely point at it (a library draft, a
 * record, an objective, a council session) stay, without the pointer.
 */
export function withoutDeleted(snapshot: WorkSnapshot): WorkSnapshot {
  const gone = new Set(
    snapshot.areas
      .filter((area) => area.status === "deleted")
      .map((area) => area.id),
  );
  if (!gone.size) return snapshot;
  const dead = (id: unknown) => typeof id === "string" && gone.has(id);
  const kept = (ids: unknown) =>
    Array.isArray(ids) ? ids.filter((id) => !dead(id)) : ids;
  const unlinkOnly = new Set(["council", "decisions", "reminders"]);
  const result: Record<string, unknown> = { ...snapshot };
  for (const [key, value] of Object.entries(snapshot)) {
    if (!Array.isArray(value)) continue;
    result[key] = (value as Record<string, unknown>[])
      .filter((item) => {
        if (!item || typeof item !== "object") return true;
        if (key === "areas" || key === "rfps") return !dead(item.id);
        if (key === "relations") return !dead(item.fromId) && !dead(item.toId);
        return unlinkOnly.has(key) || !dead(item.workAreaId);
      })
      .map((item) => {
        if (!item || typeof item !== "object") return item;
        const next = { ...item };
        if (dead(next.workAreaId)) next.workAreaId = null;
        if ("workAreaIds" in next) next.workAreaIds = kept(next.workAreaIds);
        if ("links" in next) next.links = kept(next.links);
        if (dead(next.deliveryProjectId)) next.deliveryProjectId = null;
        return next;
      });
  }
  return result as WorkSnapshot;
}

export class WorkStore {
  private readonly db: Database;
  private readonly redactor: Redactor;
  private readonly now: () => Date;
  constructor(
    db: Database,
    redactor = new Redactor(),
    now: () => Date = () => new Date(),
  ) {
    this.db = db;
    this.redactor = redactor;
    this.now = now;
    this.reminders = new WorkReminders(db, now, (text) => this.clean(text));
  }
  readonly reminders: WorkReminders;
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
  /** How many versions the snapshot carries; older ones stay in the database. */
  private static readonly versionsShown = 30;
  private versionsOf(outputId: string, approved: unknown) {
    const rows = this.all(
      "SELECT version,body,author,author_known,created_at FROM library_output_versions WHERE output_id=? ORDER BY version DESC LIMIT ?",
      outputId,
      WorkStore.versionsShown,
    );
    const latest = rows.length ? Number(rows[0]!.version) : 1;
    return {
      version: latest,
      approvedVersion: approved === null ? null : Number(approved),
      versions: rows.map((row) => ({
        version: Number(row.version),
        author: row.author_known
          ? (row.author as "owner" | "firstmate" | "agent")
          : null,
        createdAt: String(row.created_at),
        body: String(row.body),
      })),
    };
  }
  private addVersion(
    outputId: string,
    body: string,
    author: string,
    now: string,
  ) {
    this.run(
      "INSERT INTO library_output_versions(output_id,version,body,author,created_at) VALUES (?,COALESCE((SELECT MAX(version) FROM library_output_versions WHERE output_id=?),0)+1,?,?,?)",
      outputId,
      outputId,
      body,
      author,
      now,
    );
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

  /** RFP work areas made before they were board records get one, once. */
  private adoptRfps() {
    this.run(
      "INSERT OR IGNORE INTO rfps(work_area_id,client,stage) SELECT id,'','received' FROM work_areas WHERE type='rfp' AND status<>'deleted' AND id NOT IN (SELECT work_area_id FROM rfps)",
    );
  }

  /** Products created through earlier flows become product work areas. */
  private adoptProducts() {
    this.run(
      "INSERT INTO work_areas(id,type,name,product_id,last_context_at,created_at) SELECT 'area-' || id,'product',name,id,created_at,created_at FROM products WHERE id NOT IN (SELECT product_id FROM work_areas WHERE product_id IS NOT NULL)",
    );
  }
  /** Whether a work exists and has not been deleted. */
  private live(areaId: string) {
    return !!this.get(
      "SELECT 1 FROM work_areas WHERE id=? AND status<>'deleted'",
      areaId,
    );
  }
  /**
   * Every work. A deleted one is left out unless asked for: only the
   * snapshot needs them, to know what else to leave out.
   */
  private areas(withDeleted = false): WorkSnapshot["areas"] {
    return this.all(
      `SELECT * FROM work_areas ${withDeleted ? "" : "WHERE status<>'deleted' "}ORDER BY created_at,id`,
    ).map((row) => ({
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
      priority:
        (row.priority as "low" | "medium" | "high" | "urgent" | null) ?? null,
      keptHere: list(row.kept_here_json).map(String),
      firstChat: {
        title: (row.first_chat_title as string | null) ?? null,
        archivedAt: (row.first_chat_archived_at as string | null) ?? null,
        pinOrder:
          row.first_chat_pin_order === null ||
          row.first_chat_pin_order === undefined
            ? null
            : Number(row.first_chat_pin_order),
        titleBy: String(row.first_chat_title_by ?? ""),
      },
    }));
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
          splitFrom: (row.split_from as string | null) ?? null,
          createdAt: String(row.created_at),
        };
      },
    );
  }

  snapshot(): WorkSnapshot {
    this.adoptProducts();
    this.resolveSuperseded();
    this.adoptRfps();
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
    return withoutDeleted(
      workSnapshot.parse({
        version: 1,
        kind: "work-snapshot",
        setup: this.setup(),
        groups: this.all(
          "SELECT id,name,position FROM work_groups ORDER BY position,id",
        ),
        routes: this.all(
          "SELECT id,group_id AS groupId,condition,tracker FROM routing_rules ORDER BY created_at,id",
        ),
        areas: this.areas(true),
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
            dueDate: (row.due_date as string | null) ?? null,
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
        sprintDecisions: this
          .all(`SELECT s.ref,m.work_area_id AS workAreaId,m.chat_id AS chatId,
          json_extract(s.scope_json,'$.product') AS productId,json_extract(s.scope_json,'$.source') AS sourceId,
          json_extract(s.scope_json,'$.destination.team') AS team,json_extract(s.scope_json,'$.level') AS backlog,
          json_extract(s.scope_json,'$.sprintId') AS sprintId,i.item_id AS storyId
          FROM sprint_submissions s JOIN sprint_submission_items i ON i.ref=s.ref AND i.state='held'
          JOIN work_messages m ON m.id=s.receipt_id JOIN work_attention d ON d.id='sprint-held:'||s.ref||':'||i.item_id AND d.state<>'done'`),
        sprintCarryovers: this.all(`
          SELECT m.work_area_id AS workAreaId, m.chat_id AS chatId, s.ref,
            json_extract(s.scope_json,'$.product') AS productId, json_extract(s.scope_json,'$.source') AS sourceId,
            json_extract(s.scope_json,'$.destination.team') AS team,
            json_extract(s.scope_json,'$.sprintId') AS fromId, json_extract(j.value,'$.targetSprintId') AS toId,
            json_extract(j.value,'$.title') AS title, i.item_id AS storyId, json_extract(j.value,'$.to') AS destination,
            i.remote_rev AS revision, rtrim(json_extract(s.scope_json,'$.destination.collection'),'/') || '/_workitems/edit/' || i.item_id AS storyUrl
          FROM sprint_submissions s JOIN work_messages m ON m.id=s.receipt_id
          JOIN sprint_submission_items i ON i.ref=s.ref AND i.state='confirmed' AND i.remote_rev>0
          JOIN json_each(s.scope_json,'$.moves') j ON json_extract(j.value,'$.id')=i.item_id
          WHERE json_extract(j.value,'$.targetSprintId') IS NOT NULL ORDER BY m.created_at,s.ref,i.item_id
        `),
        blockers: this.all(
          "SELECT n.ref AS nudge_ref,n.text AS nudge_text,n.state AS nudge_state,b.* FROM work_blockers b LEFT JOIN blocker_nudges n ON n.blocker_id=b.id JOIN work_areas a ON a.id=b.work_area_id WHERE a.status<>'deleted' ORDER BY b.raised_at,b.id",
        ).map((row) => ({
          id: String(row.id),
          workAreaId: String(row.work_area_id),
          title: String(row.title),
          owner: (row.owner as string | null) ?? null,
          nudge: row.nudge_ref
            ? {
                ref: row.nudge_ref,
                text: row.nudge_text,
                state: row.nudge_state,
              }
            : null,
          ...(row.nudge_ref
            ? {
                ownerReplies: this.all(
                  "SELECT comment_id AS id,version,url,body,proposal,state FROM blocker_comment_reviews WHERE blocker_id=? ORDER BY comment_id,version",
                  row.id,
                ),
              }
            : {}),
          ...(row.azure_indicator_json
            ? { azureIndicator: JSON.parse(String(row.azure_indicator_json)) }
            : {}),
          ...(row.azure_check_pending ? { azureCheckPending: true } : {}),
          sprintLink: row.sprint_link_json
            ? JSON.parse(String(row.sprint_link_json))
            : null,
          raisedAt: String(row.raised_at),
          resolvedAt: (row.resolved_at as string | null) ?? null,
        })),
        reminders: this.reminders.list(),
        rfps: this.all(
          "SELECT r.*, a.created_at AS area_created_at FROM rfps r JOIN work_areas a ON a.id=r.work_area_id ORDER BY r.work_area_id",
        ).map((row) => ({
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
          value: (row.value as number | null) ?? null,
          nextStep: (row.next_step as string | null) ?? null,
          nextStepAt: (row.next_step_at as string | null) ?? null,
          heldAt: (row.held_at as string | null) ?? null,
          holdReason: (row.hold_reason as string | null) ?? null,
          requirements: String(row.requirements ?? ""),
          source: (row.source as string | null) ?? null,
          // An RFP tracked before this was kept arrived when it was added.
          receivedAt:
            (row.received_at as string | null) ??
            (row.area_created_at as string | null) ??
            null,
          clarificationsBy: (row.clarifications_by as string | null) ?? null,
          team: list(row.team_json) as string[],
          closedAt: (row.closed_at as string | null) ?? null,
          summaries: this.all(
            "SELECT id,text,created_at FROM rfp_summaries WHERE work_area_id=? ORDER BY created_at DESC, rowid DESC",
            row.work_area_id as string,
          ).map((note) => ({
            id: String(note.id),
            text: String(note.text),
            createdAt: String(note.created_at),
          })),
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
            ...this.versionsOf(String(row.id), row.approved_version),
            acceptance:
              row.acceptance === null || row.acceptance === undefined
                ? null
                : {
                    decision: row.acceptance as
                      "accepted" | "not_yet" | "rejected",
                    version: Number(row.acceptance_version),
                    reason: String(row.acceptance_reason ?? ""),
                    decidedAt: String(row.acceptance_at),
                  },
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
              record.linkage === "link_later" ||
              record.linkage === "unresolved",
            body: record.body,
            updatedAt: record.updatedAt,
            version: 1,
            approvedVersion: null,
            acceptance: null,
            versions: [],
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
          facts: this.all(
            "SELECT id,group_id AS groupId,key,value,source,observed_at AS observedAt,confirmed,synced FROM memory_claims WHERE state='current' ORDER BY observed_at DESC,id",
          ).map((row) => ({
            ...row,
            confirmed: bool(row.confirmed),
            synced: bool(row.synced),
          })),
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
        messages: this.chatMessages(null),
        chats: this.all(
          "SELECT c.id,c.work_area_id AS workAreaId,c.title,c.kind,c.archived_at AS archivedAt,c.forked_from AS forkedFrom,c.from_chat_id AS fromChatId,c.created_at AS createdAt,c.pin_order AS pinOrder,c.title_by AS titleBy FROM work_chats c JOIN work_areas a ON a.id=c.work_area_id WHERE a.status<>'deleted' ORDER BY c.created_at,c.rowid",
        ).map((chat) => ({
          ...chat,
          // A chat the owner started has no fork point.
          forkedFrom: chat.forkedFrom ? String(chat.forkedFrom) : null,
          pinOrder: chat.pinOrder === null ? null : Number(chat.pinOrder),
          titleBy: String(chat.titleBy ?? ""),
          messages: this.chatMessages(String(chat.id)),
        })),
        requests: this.all(
          "SELECT ref,message_id,project_area_id,status,role,detail,parts,updated_at,change_to_area_id,change_state FROM work_requests ORDER BY updated_at,ref",
        ).map((row) => ({
          ref: String(row.ref),
          messageId: String(row.message_id),
          projectAreaId: (row.project_area_id as string | null) ?? null,
          status: String(
            row.status,
          ) as WorkSnapshot["requests"][number]["status"],
          role: String(row.role),
          detail: String(row.detail),
          parts: Number(row.parts),
          updatedAt: String(row.updated_at),
          changeToAreaId: (row.change_to_area_id as string | null) ?? null,
          changeState: String(
            row.change_state,
          ) as WorkSnapshot["requests"][number]["changeState"],
        })),
        delivery: this.deliverySummary(),
        deliveryLinks: this.all(
          "SELECT kind,from_id,to_id FROM delivery_links ORDER BY created_at",
        ).map((row) => ({
          kind: String(
            row.kind,
          ) as WorkSnapshot["deliveryLinks"][number]["kind"],
          fromId: String(row.from_id),
          toId: String(row.to_id),
        })),
      }),
    );
  }
  /** Epics, stories and requirements per product or delivery project. */
  private deliverySummary(): WorkSnapshot["delivery"] {
    return this.all(
      "SELECT id,type,product_id,delivery FROM work_areas WHERE product_id IS NOT NULL AND status<>'deleted' AND type IN ('product','project')",
    ).map((area) => {
      const productId = String(area.product_id);
      const prd = this.get(
        "SELECT p.version,p.delivered_at,(SELECT count(*) FROM prd_versions v JOIN approvals a ON a.prd_version_id=v.id AND a.decision='approved' WHERE v.prd_id=p.id AND v.version=p.version) AS approved FROM prds p WHERE p.product_id=? ORDER BY p.rowid DESC LIMIT 1",
        productId,
      );
      return {
        workAreaId: String(area.id),
        productId,
        delivery: area.type === "product" || Number(area.delivery) === 1,
        items: this.all(
          "SELECT id,type,title,parent_id,status,remote_system,remote_id FROM work_items WHERE product_id=? ORDER BY rowid",
          productId,
        ).map((item) => ({
          id: String(item.id),
          type: String(item.type),
          title: String(item.title),
          parentId: (item.parent_id as string | null) ?? null,
          status: String(item.status),
          tool: (item.remote_system as string | null) ?? null,
          key:
            item.remote_id === null || item.remote_id === undefined
              ? null
              : String(item.remote_id),
        })),
        requirements: prd
          ? {
              label: area.type === "project" ? "BRD" : "PRD",
              version: prd.version === null ? null : Number(prd.version),
              approved: Number(prd.approved) > 0,
              deliveredAt: (prd.delivered_at as string | null) ?? null,
            }
          : null,
      };
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
    const row = this.get(
      "SELECT group_id FROM work_areas WHERE id=? AND status<>'deleted'",
      areaId,
    );
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
    priority?: string | undefined;
    convertedFrom?: string;
  }) {
    this.requireGroup(input.groupId);
    const name = this.clean(input.name);
    // Never silently create a duplicate of the same kind in the same group.
    const twin = this.get(
      "SELECT id FROM work_areas WHERE type=? AND lower(name)=lower(?) AND ifnull(group_id,'')=ifnull(?,'') AND status<>'deleted'",
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
      "INSERT INTO work_areas(id,group_id,type,name,purpose,product_id,client,due_at,effort,stakeholder,priority,last_context_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
      input.priority ?? null,
      now,
      now,
    );
    return { id, existing: false };
  }

  /** One chat's messages in order; null is every work's main chat. */
  private chatMessages(chatId: string | null) {
    return this.all(
      `SELECT id,work_area_id AS workAreaId,role,text,card_json,model,created_at AS createdAt,read_at AS readAt FROM work_messages WHERE ${chatId === null ? "chat_id IS NULL" : "chat_id=?"} ORDER BY created_at,rowid`,
      ...(chatId === null ? [] : [chatId]),
    ).map(({ card_json, ...row }) => ({
      ...row,
      card: card_json ? JSON.parse(String(card_json)) : null,
    }));
  }

  /** Content search, always limited to the group the owner is working in. */
  search(query: string) {
    return searchContent(this.db, query, this.setup().activeGroupId);
  }
  async inspectNavigation(
    ref: string,
    space: string,
    prompt: string,
    send: (prompt: string) => Promise<void>,
  ) {
    const activity = this.get(
      "SELECT id,text,state FROM work_activity WHERE ref=?",
      ref,
    );
    if (!activity || activity.text !== this.clean(prompt))
      throw new WorkError("The navigation request changed.");
    const claimed = this.run(
      "INSERT OR IGNORE INTO navigation_dispatches VALUES(?,?,?,'pending')",
      ref,
      activity.id,
      space,
    ).changes;
    if (!claimed) {
      const prior = this.get(
        "SELECT state FROM navigation_dispatches WHERE ref=? AND space=?",
        ref,
        space,
      );
      if (!prior)
        throw new WorkError(
          "The navigation request belongs to another Firstmate space.",
        );
      return { delivered: prior.state === "delivered" };
    }
    let delivered = false;
    try {
      await send(prompt);
      delivered = true;
    } catch {}
    this.db
      .transaction(() => {
        this.run(
          "UPDATE navigation_dispatches SET state=? WHERE ref=?",
          delivered ? "delivered" : "unknown",
          ref,
        );
        this.run(
          "UPDATE work_activity SET state=? WHERE id=?",
          delivered ? "finished" : "failed",
          activity.id,
        );
      })
      .immediate();
    return { delivered };
  }
  async draftNudge(
    input: unknown,
    send: (prompt: string) => Promise<string>,
    space?: string,
  ) {
    const command = workCommand.parse(input);
    if (command.action !== "draft-blocker-message")
      throw Error("Unknown blocker draft action.");
    await draftBlockerNudge(
      this.db,
      command,
      async (prompt) => this.clean(await send(prompt)),
      space,
    );
    return this.snapshot();
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
        // An RFP area is a board record from the start, so it is never a
        // work with no place on the RFPs board.
        if (command.type === "rfp" && !created.existing)
          this.run(
            "INSERT OR IGNORE INTO rfps(work_area_id,client,stage,deadline) VALUES (?,?,'received',?)",
            created.id,
            command.client ? this.clean(command.client) : "",
            command.dueAt ?? null,
          );
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
        if (!area || area.status === "deleted")
          throw new WorkError("That work area no longer exists.");
        const patch = command.patch;
        if (patch.status === "deleted")
          throw new WorkError("Use Delete to remove a work.");
        // An RFP keeps its client on its own record.
        if (patch.client !== undefined && area.type !== "project")
          throw new WorkError("Only a project has a client here.");
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
          [
            "client",
            patch.client === undefined
              ? undefined
              : patch.client === null || !patch.client.trim()
                ? null
                : this.clean(patch.client.trim()),
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
        // A product work and its product record carry one name.
        if (patch.name !== undefined && area.product_id)
          this.run(
            "UPDATE products SET name=? WHERE id=?",
            this.clean(patch.name),
            area.product_id,
          );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id=?",
          now,
          command.areaId,
        );
        return {};
      }
      case "delete-area": {
        const area = this.get(
          "SELECT status FROM work_areas WHERE id=?",
          command.areaId,
        );
        if (!area || area.status === "deleted")
          throw new WorkError("That work area no longer exists.");
        // Removed from everything Amun shows, with its chat, plans and
        // anything waiting on it. The rows stay in the local file, so a
        // delete can be undone by hand and nothing that points at the work
        // is left dangling. Nothing outside Amun is touched: stories already
        // in Azure DevOps and pages already in Notion stay where they are.
        this.run(
          "UPDATE work_areas SET status='deleted',last_context_at=? WHERE id=?",
          now,
          command.areaId,
        );
        this.run(
          "UPDATE work_attention SET state='done' WHERE work_area_id=? AND state<>'done'",
          command.areaId,
        );
        this.run(
          "UPDATE work_activity SET state='finished' WHERE work_area_id=? AND state='running'",
          command.areaId,
        );
        return { ref: command.areaId };
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
          "INSERT INTO work_objectives(id,group_id,metric,baseline,target,current,evidence_date,review_date,due_date,conflict) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metric=excluded.metric,baseline=excluded.baseline,target=excluded.target,current=excluded.current,evidence_date=excluded.evidence_date,review_date=excluded.review_date,due_date=excluded.due_date,conflict=excluded.conflict",
          id,
          command.groupId,
          this.clean(command.metric),
          command.baseline,
          command.target,
          command.current,
          command.evidenceDate,
          command.reviewDate,
          command.dueDate,
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
          "INSERT INTO work_plans(id,group_id,work_area_id,kind,destination,summary,items_json,state,created_at,chat_id,request_ref) VALUES (?,?,?,?,?,?,?,'proposed',?,?,?)",
          id,
          groupId,
          command.workAreaId,
          command.planKind,
          command.destination,
          this.clean(command.summary),
          JSON.stringify(command.items),
          now,
          command.chatId ?? null,
          command.requestRef ?? null,
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
        return this.approvePlan(
          command.planId,
          command.fingerprint,
          command.itemIds,
        );
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
        // Resolving twice changes nothing: one click, or two, is one answer.
        if (item.state === "done") return { ref: command.attentionId };
        this.run(
          "UPDATE work_attention SET state='done',answer=?,resolved_at=? WHERE id=?",
          command.answer ? this.clean(command.answer) : null,
          now,
          command.attentionId,
        );
        // Accepting an offer closes it and nothing more. Firstmate drafts it
        // when the owner's conversation sends the request, so there is no
        // "running" row here that no turn stands behind.
        return { ref: command.attentionId };
      }
      case "raise-blocker": {
        this.groupOf(command.areaId);
        const id = randomUUID();
        const owner = command.owner?.trim();
        this.run(
          "INSERT INTO work_blockers(id,work_area_id,title,owner,raised_at) VALUES (?,?,?,?,?)",
          id,
          command.areaId,
          this.clean(command.title),
          owner ? this.clean(owner) : null,
          now,
        );
        return { ref: id };
      }
      case "draft-blocker-message":
        throw new WorkError(
          "Open the sprint conversation to draft with Firstmate.",
        );
      case "record-blocker-message": {
        try {
          if (
            recordNudgeAction(
              this.db,
              command.areaId,
              command.blockerId,
              command.ref,
              this.clean(command.body),
              command.disposition,
            )
          )
            this.activity({
              groupId: this.groupOf(command.areaId),
              workAreaId: command.areaId,
              text:
                command.disposition === "copied"
                  ? "Copied blocker message · delivery unconfirmed"
                  : "Sent manually · confirmed by you",
              ref: command.ref,
              state: "finished",
            });
        } catch {
          throw new WorkError(
            "The message draft changed. Check the blocker before recording delivery.",
          );
        }
        return { ref: command.ref };
      }
      case "link-blocker-story": {
        const record = this.get(
          "SELECT sprint_link_json FROM work_blockers WHERE id=? AND work_area_id=? AND resolved_at IS NULL",
          command.blockerId,
          command.areaId,
        );
        if (!record)
          throw new WorkError(
            "The open blocker is unavailable in this work area.",
          );
        const link = JSON.stringify({
          sourceId: command.sourceId,
          sprintId: command.sprintId,
          storyId: command.storyId,
          ...(command.teamId ? { teamId: command.teamId } : {}),
          ...(command.trackAzureIndicator ? { trackAzureIndicator: true } : {}),
        });
        if (record.sprint_link_json && record.sprint_link_json !== link)
          throw new WorkError(
            "This blocker already has a different story link.",
          );
        this.run(
          "UPDATE work_blockers SET sprint_link_json=? WHERE id=?",
          link,
          command.blockerId,
        );
        return { ref: command.blockerId };
      }
      case "set-blocker-owner": {
        const owner = command.owner?.trim();
        const changed = this.run(
          "UPDATE work_blockers SET owner=? WHERE id=? AND resolved_at IS NULL",
          owner ? this.clean(owner) : null,
          command.blockerId,
        ).changes;
        if (!changed) throw new WorkError("That blocker is already cleared.");
        return { ref: command.blockerId };
      }
      case "reminder":
        return this.reminders.request(command.text, command.workAreaId);
      case "finish-reminder":
        this.reminders.finish(command.reminderId);
        return {};
      case "snooze-reminder":
        this.reminders.snooze(command.reminderId);
        return {};
      case "cancel-reminder":
        this.reminders.cancel(command.reminderId);
        return {};
      case "resolve-blocker":
        // Clearing twice changes nothing.
        this.run(
          "UPDATE work_blockers SET resolved_at=? WHERE id=? AND resolved_at IS NULL",
          now,
          command.blockerId,
        );
        return { ref: command.blockerId };
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
        // Moving an RFP takes it off hold. The day it was decided is kept.
        const decided = ["won", "lost", "withdrawn"].includes(command.stage);
        this.run(
          "UPDATE rfps SET stage=?,loss_reason=?,held_at=NULL,hold_reason=NULL,closed_at=? WHERE work_area_id=?",
          command.stage,
          command.stage === "lost" && command.lossReason
            ? this.clean(command.lossReason)
            : command.stage === "lost"
              ? rfp.loss_reason
              : null,
          decided
            ? rfp.stage === command.stage && rfp.closed_at
              ? rfp.closed_at
              : now
            : command.stage === "handed_to_delivery"
              ? rfp.closed_at
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
      case "update-rfp": {
        const rfp = this.get(
          "SELECT work_area_id FROM rfps WHERE work_area_id=?",
          command.areaId,
        );
        if (!rfp) throw new WorkError("That RFP no longer exists.");
        const { patch } = command;
        const columns: [string, unknown][] = [];
        const words = (value: string | null) =>
          value && value.trim() ? this.clean(value) : null;
        if (patch.value !== undefined) columns.push(["value", patch.value]);
        if (patch.nextStep !== undefined)
          columns.push(["next_step", words(patch.nextStep)]);
        if (patch.nextStepAt !== undefined)
          columns.push(["next_step_at", patch.nextStepAt]);
        if (patch.requirements !== undefined)
          columns.push(["requirements", this.clean(patch.requirements)]);
        if (patch.source !== undefined)
          columns.push(["source", words(patch.source)]);
        if (patch.receivedAt !== undefined)
          columns.push(["received_at", patch.receivedAt]);
        if (patch.clarificationsBy !== undefined)
          columns.push(["clarifications_by", patch.clarificationsBy]);
        if (patch.team !== undefined)
          columns.push([
            "team_json",
            JSON.stringify([
              ...new Set(patch.team.map((person) => this.clean(person))),
            ]),
          ]);
        if (columns.length) {
          this.run(
            `UPDATE rfps SET ${columns.map(([name]) => `${name}=?`).join(",")} WHERE work_area_id=?`,
            ...columns.map(([, value]) => value),
            command.areaId,
          );
          this.run(
            "UPDATE work_areas SET last_context_at=? WHERE id=?",
            now,
            command.areaId,
          );
        }
        return { ref: command.areaId };
      }
      case "hold-rfp": {
        const rfp = this.get(
          "SELECT * FROM rfps WHERE work_area_id=?",
          command.areaId,
        );
        if (!rfp) throw new WorkError("That RFP no longer exists.");
        if (
          command.held &&
          !["received", "in_response", "submitted"].includes(String(rfp.stage))
        )
          throw new WorkError(
            "Only an RFP that is still open can be put on hold.",
          );
        this.run(
          "UPDATE rfps SET held_at=?,hold_reason=? WHERE work_area_id=?",
          command.held ? ((rfp.held_at as string | null) ?? now) : null,
          command.held && command.reason.trim()
            ? this.clean(command.reason)
            : null,
          command.areaId,
        );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id=?",
          now,
          command.areaId,
        );
        return { ref: command.areaId };
      }
      case "add-rfp-summary": {
        if (
          !this.get(
            "SELECT work_area_id FROM rfps WHERE work_area_id=?",
            command.areaId,
          )
        )
          throw new WorkError("That RFP no longer exists.");
        const summaryId = randomUUID();
        this.run(
          "INSERT INTO rfp_summaries(id,work_area_id,text,created_at) VALUES (?,?,?,?)",
          summaryId,
          command.areaId,
          this.clean(command.text),
          now,
        );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id=?",
          now,
          command.areaId,
        );
        return { ref: summaryId };
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
        if (!this.live(command.workAreaId))
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
        if (!this.live(command.workAreaId))
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
      case "edit-sprint-draft": {
        if (command.end && command.start && command.end < command.start)
          throw new WorkError("A sprint cannot end before it starts.");
        const saved = this.db
          .prepare(
            "UPDATE work_sprints SET name=?,goal=?,start=?,end=? WHERE id=? AND work_area_id=? AND draft=1",
          )
          .run(
            this.clean(command.name),
            this.clean(command.goal),
            command.start,
            command.end,
            command.sprintId,
            command.workAreaId,
          );
        if (!saved.changes)
          throw new WorkError(
            "This sprint draft is no longer available in the selected work area.",
          );
        return { ref: command.sprintId };
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
        const body = this.clean(command.body);
        const before = this.get(
          "SELECT body FROM library_outputs WHERE id=?",
          id,
        );
        this.run(
          "INSERT INTO library_outputs(id,group_id,type,title,body,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,status=excluded.status,type=excluded.type,updated_at=excluded.updated_at",
          id,
          command.groupId,
          command.type,
          this.clean(command.title),
          body,
          command.status,
          now,
          now,
        );
        if (!before || String(before.body) !== body)
          this.addVersion(id, body, command.author, now);
        this.run("DELETE FROM library_output_links WHERE output_id=?", id);
        for (const areaId of command.workAreaIds)
          this.run(
            "INSERT INTO library_output_links(output_id,work_area_id) VALUES (?,?)",
            id,
            areaId,
          );
        return { ref: id };
      }
      case "restore-output-version": {
        const row = this.get(
          "SELECT v.body FROM library_output_versions v JOIN library_outputs o ON o.id=v.output_id WHERE v.output_id=? AND v.version=?",
          command.outputId,
          command.versionNumber,
        );
        if (!row)
          throw new WorkError("That version is no longer there.", {
            reason: "missing_version",
          });
        this.run(
          "UPDATE library_outputs SET body=?,updated_at=? WHERE id=?",
          String(row.body),
          now,
          command.outputId,
        );
        this.addVersion(command.outputId, String(row.body), "owner", now);
        return { ref: command.outputId };
      }
      case "approve-output": {
        const row = this.get(
          "SELECT MAX(version) AS latest FROM library_output_versions WHERE output_id=?",
          command.outputId,
        );
        if (!row || row.latest === null)
          throw new WorkError("That document is no longer there.", {
            reason: "missing_output",
          });
        if (
          command.versionNumber !== undefined &&
          command.versionNumber !== Number(row.latest)
        )
          throw new WorkError(
            "The document changed. Open its latest version before approving.",
            {
              reason: "stale_version",
            },
          );
        this.run(
          "UPDATE library_outputs SET approved_version=?,approved_at=? WHERE id=?",
          command.approved ? Number(row.latest) : null,
          command.approved ? now : null,
          command.outputId,
        );
        return { ref: command.outputId };
      }
      case "record-acceptance": {
        const row = this.get(
          "SELECT o.type,(SELECT MAX(version) FROM library_output_versions WHERE output_id=o.id) AS latest FROM library_outputs o WHERE o.id=?",
          command.outputId,
        );
        if (!row)
          throw new WorkError("That document is no longer there.", {
            reason: "missing_output",
          });
        if (row.type !== "acceptance")
          throw new WorkError("Only an acceptance checklist can be accepted.", {
            reason: "not_a_checklist",
          });
        if (command.decision !== null && !command.reason)
          throw new WorkError("Add a short reason for your decision.", {
            reason: "reason_needed",
          });
        this.run(
          "UPDATE library_outputs SET acceptance=?,acceptance_version=?,acceptance_reason=?,acceptance_at=? WHERE id=?",
          command.decision,
          command.decision ? Number(row.latest) : null,
          command.decision ? this.clean(command.reason) : null,
          command.decision ? now : null,
          command.outputId,
        );
        return { ref: command.outputId };
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
      case "agent-status": {
        if (!this.get("SELECT 1 FROM work_agents WHERE kind='lead'"))
          this.run(
            "INSERT INTO work_agents(id,role,kind,state,created_at) VALUES ('firstmate','Firstmate','lead','idle',?)",
            now,
          );
        const role = this.clean(command.role);
        let agent = this.get(
          "SELECT id,state,now_doing FROM work_agents WHERE lower(role)=lower(?)",
          role,
        );
        // A new task starts without the last task's output.
        const nowDoing =
          command.nowDoing === null ? null : this.clean(command.nowDoing);
        const startsTask =
          !!agent &&
          command.state === "working" &&
          (agent.state === "idle" ||
            agent.state === "done" ||
            agent.now_doing !== nowDoing);
        if (!agent) {
          // An agent Firstmate brought in for this job only.
          const id = randomUUID();
          this.run(
            "INSERT INTO work_agents(id,role,kind,launcher_id,state,created_at) VALUES (?,?,'temporary','firstmate','idle',?)",
            id,
            role,
            now,
          );
          agent = { id };
        }
        this.run(
          "UPDATE work_agents SET state=?,now_doing=?,enabled=1 WHERE id=?",
          command.state,
          nowDoing,
          agent.id,
        );
        if (command.output === undefined && startsTask)
          this.run("UPDATE work_agents SET output='' WHERE id=?", agent.id);
        if (command.output !== undefined)
          this.run(
            "UPDATE work_agents SET output=? WHERE id=?",
            command.output.slice(0, 20000),
            agent.id,
          );
        return { ref: String(agent.id) };
      }
      case "toggle-agent":
        this.run(
          "UPDATE work_agents SET enabled=? WHERE id=? AND kind<>'lead'",
          command.enabled ? 1 : 0,
          command.agentId,
        );
        return {};
      case "edit-agent":
        // The First Mate edits its agents; Amun stores nothing for this.
        return {};
      case "navigation-activity": {
        const existing = this.get(
          "SELECT id,text,work_area_id FROM work_activity WHERE ref=?",
          command.ref,
        );
        const prompt = this.clean(command.prompt);
        if (existing) {
          if (
            existing.text !== prompt ||
            existing.work_area_id !== command.workAreaId
          )
            throw new WorkError(
              "This navigation reference belongs to another click.",
            );
          if (command.delivered)
            this.run(
              "UPDATE work_activity SET state='finished' WHERE id=?",
              existing.id,
            );
          return { ref: String(existing.id) };
        }
        return {
          ref: this.activity({
            groupId: this.groupOf(command.workAreaId),
            workAreaId: command.workAreaId,
            text: prompt,
            ref: command.ref,
            state: command.delivered ? "finished" : "running",
          }),
        };
      }
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
          const report = command.recommendation
            ? this.clean(command.recommendation)
            : "";
          this.run(
            "INSERT INTO library_outputs(id,group_id,type,title,body,status,created_at,updated_at) VALUES (?,?,'council_report',?,?,'Advisory',?,?)",
            output,
            groupId,
            this.clean(`Council · ${command.decision}`),
            report,
            now,
            now,
          );
          this.addVersion(output, report, "firstmate", now);
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
      case "correct-claim": {
        const fact = this.get(
          "SELECT id FROM memory_claims WHERE id=? AND state='current'",
          command.claimId,
        );
        if (!fact) throw new WorkError("That fact is no longer remembered.");
        // Replaced in place: the old wording is not kept. It is sent on again.
        this.run(
          "UPDATE memory_claims SET value=?,source='Corrected by you',observed_at=?,confirmed=1,synced=0 WHERE id=?",
          this.clean(command.value),
          now,
          command.claimId,
        );
        return { ref: command.claimId };
      }
      case "forget-claim": {
        const fact = this.get(
          "SELECT group_id,key FROM memory_claims WHERE id=? AND state='current'",
          command.claimId,
        );
        if (!fact) throw new WorkError("That fact is no longer remembered.");
        // The earlier versions and any open question about it go too.
        const same = this.all(
          "SELECT id FROM memory_claims WHERE ifnull(group_id,'')=ifnull(?,'') AND key=?",
          fact.group_id,
          fact.key,
        ).map((row) => String(row.id));
        for (const id of same)
          this.run(
            "UPDATE work_attention SET state='done',answer='Forgotten',resolved_at=? WHERE ref=? AND state!='done'",
            now,
            "claim:" + id,
          );
        this.run(
          "DELETE FROM memory_claims WHERE ifnull(group_id,'')=ifnull(?,'') AND key=?",
          fact.group_id,
          fact.key,
        );
        return {};
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
        if (!this.live(command.workAreaId))
          throw new WorkError("That work area no longer exists.");
        if (
          command.chatId !== null &&
          !this.get(
            "SELECT 1 FROM work_chats WHERE id=? AND work_area_id=?",
            command.chatId,
            command.workAreaId,
          )
        )
          throw new WorkError("That chat no longer exists.");
        const id = randomUUID();
        this.run(
          "INSERT INTO work_messages(id,work_area_id,chat_id,role,text,card_json,model,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,?)",
          id,
          command.workAreaId,
          command.chatId,
          command.role,
          this.clean(command.text),
          command.card === null ? null : JSON.stringify(command.card),
          command.role === "firstmate" ? command.model : null,
          now,
          // Only a reply from Firstmate waits to be read.
          command.role === "firstmate" ? null : now,
        );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id=?",
          now,
          command.workAreaId,
        );
        // A chat is named by the owner's first message in it.
        // A typed command such as "/model" says nothing about the subject, so
        // it never names a chat, and a chat it named earlier is named again
        // by the first real message (owner, 20 November 2026).
        if (command.role === "you" && !isTypedCommand(command.text)) {
          const title = chatTitle(command.text);
          if (command.chatId === null)
            this.run(
              "UPDATE work_areas SET first_chat_title=? WHERE id=? AND first_chat_title_by='' AND (first_chat_title IS NULL OR (first_chat_title GLOB '/[a-z]*' AND first_chat_title NOT LIKE '% %'))",
              title,
              command.workAreaId,
            );
          else
            this.run(
              "UPDATE work_chats SET title=? WHERE id=? AND title_by='' AND (title='' OR (title GLOB '/[a-z]*' AND title NOT LIKE '% %'))",
              title,
              command.chatId,
            );
        }
        return { ref: id };
      }
      case "fork-chat": {
        if (!this.live(command.workAreaId))
          throw new WorkError("That work area no longer exists.");
        const from = this.get(
          "SELECT rowid AS seq,chat_id AS chatId,text,created_at AS createdAt FROM work_messages WHERE id=? AND work_area_id=?",
          command.messageId,
          command.workAreaId,
        );
        if (!from) throw new WorkError("That message is no longer there.");
        const fromChat = from.chatId === null ? null : String(from.chatId);
        const line = String(from.text).replace(/\s+/g, " ").trim();
        const id = randomUUID();
        this.run(
          "INSERT INTO work_chats(id,work_area_id,title,forked_from,from_chat_id,created_at) VALUES (?,?,?,?,?,?)",
          id,
          command.workAreaId,
          chatTitle(line) || "Fork",
          command.messageId,
          fromChat,
          now,
        );
        // Everything up to and including that message, in the same order.
        const kept = this.all(
          `SELECT id,role,text,card_json,model,created_at FROM work_messages WHERE work_area_id=? AND ${fromChat === null ? "chat_id IS NULL" : "chat_id=?"} AND (created_at<? OR (created_at=? AND rowid<=?)) ORDER BY created_at,rowid`,
          command.workAreaId,
          ...(fromChat === null ? [] : [fromChat]),
          from.createdAt,
          from.createdAt,
          from.seq,
        );
        for (const row of kept) {
          const copy = randomUUID();
          this.run(
            "INSERT INTO work_messages(id,work_area_id,chat_id,role,text,card_json,model,created_at) VALUES (?,?,?,?,?,?,?,?)",
            copy,
            command.workAreaId,
            id,
            row.role,
            row.text,
            row.card_json,
            row.model,
            row.created_at,
          );
          // The original is already searchable; a copy would show twice.
          this.run(
            "DELETE FROM content_index WHERE kind='message' AND ref=?",
            copy,
          );
        }
        return { ref: id };
      }
      case "delete-chat": {
        // Only the fork goes; the chat it came from is never touched.
        this.run("DELETE FROM work_messages WHERE chat_id=?", command.chatId);
        this.run(
          "UPDATE work_chats SET from_chat_id=NULL WHERE from_chat_id=?",
          command.chatId,
        );
        this.run("DELETE FROM work_chats WHERE id=?", command.chatId);
        return {};
      }
      case "new-chat": {
        if (!this.live(command.workAreaId))
          throw new WorkError("That work area no longer exists.");
        const sprint = command.sprint;
        if (sprint) {
          const existing = this.get(
            "SELECT id FROM work_chats WHERE work_area_id=? AND sprint_connection=? AND sprint_id=?",
            command.workAreaId,
            sprint.connection,
            sprint.id,
          );
          if (existing) return { ref: String(existing.id) };
        }
        const id = randomUUID();
        this.run(
          "INSERT INTO work_chats(id,work_area_id,title,kind,forked_from,from_chat_id,created_at,sprint_connection,sprint_id) VALUES (?,?,?,'chat','',NULL,?,?,?)",
          id,
          command.workAreaId,
          sprint?.name ?? "",
          now,
          sprint?.connection ?? null,
          sprint?.id ?? null,
        );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id=?",
          now,
          command.workAreaId,
        );
        return { ref: id };
      }
      case "rename-chat": {
        this.requireChat(command.workAreaId, command.chatId);
        const title = chatTitle(this.clean(command.title));
        if (command.chatId === null)
          this.run(
            "UPDATE work_areas SET first_chat_title=?,first_chat_title_by='owner' WHERE id=?",
            title,
            command.workAreaId,
          );
        else
          this.run(
            "UPDATE work_chats SET title=?,title_by='owner' WHERE id=?",
            title,
            command.chatId,
          );
        return {};
      }
      case "suggest-chat-title": {
        this.requireChat(command.workAreaId, command.chatId);
        // The owner's own name always wins, even mid-reply.
        const title = chatTitle(this.clean(command.title));
        if (!title) return {};
        if (command.chatId === null)
          this.run(
            "UPDATE work_areas SET first_chat_title=?,first_chat_title_by='firstmate' WHERE id=? AND first_chat_title_by<>'owner'",
            title,
            command.workAreaId,
          );
        else
          this.run(
            "UPDATE work_chats SET title=?,title_by='firstmate' WHERE id=? AND title_by<>'owner'",
            title,
            command.chatId,
          );
        return {};
      }
      case "pin-chat": {
        this.requireChat(command.workAreaId, command.chatId);
        if (command.chatId === null)
          this.run(
            "UPDATE work_areas SET first_chat_pin_order=? WHERE id=?",
            command.order,
            command.workAreaId,
          );
        else
          this.run(
            "UPDATE work_chats SET pin_order=? WHERE id=?",
            command.order,
            command.chatId,
          );
        return {};
      }
      case "read-messages": {
        for (const id of command.messageIds)
          this.run(
            "UPDATE work_messages SET read_at=? WHERE id=? AND read_at IS NULL",
            now,
            id,
          );
        return {};
      }
      case "archive-chat": {
        this.requireChat(command.workAreaId, command.chatId);
        const at = command.archived ? now : null;
        if (command.chatId === null)
          this.run(
            "UPDATE work_areas SET first_chat_archived_at=? WHERE id=?",
            at,
            command.workAreaId,
          );
        else
          this.run(
            "UPDATE work_chats SET archived_at=? WHERE id=?",
            at,
            command.chatId,
          );
        return {};
      }
      case "move-chat": {
        this.requireChat(command.workAreaId, command.chatId);
        if (command.toWorkAreaId === command.workAreaId)
          throw new WorkError("That chat is already in this work.");
        const to = this.get(
          "SELECT id,name,first_chat_title,first_chat_archived_at FROM work_areas WHERE id=? AND status<>'deleted'",
          command.toWorkAreaId,
        );
        if (!to) throw new WorkError("That work area no longer exists.");
        const inChat =
          command.chatId === null ? "chat_id IS NULL" : "chat_id=?";
        const chatArgs = command.chatId === null ? [] : [command.chatId];
        let from: Row | undefined;
        if (command.fromMessageId) {
          from = this.get(
            `SELECT rowid AS seq,created_at AS createdAt FROM work_messages WHERE id=? AND work_area_id=? AND ${inChat}`,
            command.fromMessageId,
            command.workAreaId,
            ...chatArgs,
          );
          if (!from) throw new WorkError("That message is no longer there.");
        }
        // That message and everything after it, or the whole chat.
        const moving = this.all(
          `SELECT id,role,text FROM work_messages WHERE work_area_id=? AND ${inChat}${from ? " AND (created_at>? OR (created_at=? AND rowid>=?))" : ""} ORDER BY created_at,rowid`,
          command.workAreaId,
          ...chatArgs,
          ...(from ? [from.createdAt, from.createdAt, from.seq] : []),
        );
        if (!moving.length) throw new WorkError("There is nothing to move.");
        const first = moving.find((row) => row.role === "you");
        const title = first ? chatTitle(String(first.text)) : "";
        // An unused first chat takes them; otherwise they get a chat of their own.
        const firstChatFree =
          to.first_chat_archived_at === null &&
          !this.get(
            "SELECT 1 FROM work_messages WHERE work_area_id=? AND chat_id IS NULL LIMIT 1",
            command.toWorkAreaId,
          );
        let target: string | null = null;
        if (firstChatFree) {
          if (title)
            this.run(
              "UPDATE work_areas SET first_chat_title=? WHERE id=?",
              title,
              command.toWorkAreaId,
            );
        } else {
          target = randomUUID();
          this.run(
            "INSERT INTO work_chats(id,work_area_id,title,kind,forked_from,from_chat_id,created_at) VALUES (?,?,?,'chat','',NULL,?)",
            target,
            command.toWorkAreaId,
            title,
            now,
          );
        }
        for (const row of moving)
          this.run(
            "UPDATE work_messages SET work_area_id=?,chat_id=? WHERE id=?",
            command.toWorkAreaId,
            target,
            row.id,
          );
        // A whole chat keeps its pin and whoever named it; a part that splits
        // off leaves the pin with the chat it came from (owner, 20 November 2026).
        if (!command.fromMessageId) {
          const source =
            command.chatId === null
              ? this.get(
                  "SELECT first_chat_pin_order AS pin,first_chat_title_by AS by,first_chat_title AS title FROM work_areas WHERE id=?",
                  command.workAreaId,
                )
              : this.get(
                  "SELECT pin_order AS pin,title_by AS by,title FROM work_chats WHERE id=?",
                  command.chatId,
                );
          const by = String(source?.by ?? "");
          const keptTitle = by && source?.title ? String(source.title) : null;
          if (target === null)
            this.run(
              "UPDATE work_areas SET first_chat_pin_order=?,first_chat_title_by=?,first_chat_title=coalesce(?,first_chat_title) WHERE id=?",
              source?.pin ?? null,
              by,
              keptTitle,
              command.toWorkAreaId,
            );
          else
            this.run(
              "UPDATE work_chats SET pin_order=?,title_by=?,title=coalesce(?,title) WHERE id=?",
              source?.pin ?? null,
              by,
              keptTitle,
              target,
            );
          if (command.chatId === null)
            this.run(
              "UPDATE work_areas SET first_chat_pin_order=NULL WHERE id=?",
              command.workAreaId,
            );
          else
            this.run(
              "UPDATE work_chats SET pin_order=NULL WHERE id=?",
              command.chatId,
            );
        }
        // The chat they left says where the conversation went.
        this.run(
          "INSERT INTO work_messages(id,work_area_id,chat_id,role,text,card_json,model,created_at) VALUES (?,?,?,'card',?,?,NULL,?)",
          randomUUID(),
          command.workAreaId,
          command.chatId,
          `Continued in ${String(to.name)}`,
          JSON.stringify({
            kind: "moved",
            toWorkAreaId: command.toWorkAreaId,
            toChatId: target,
            name: String(to.name),
          }),
          now,
        );
        this.run(
          "UPDATE work_areas SET last_context_at=? WHERE id IN (?,?)",
          now,
          command.workAreaId,
          command.toWorkAreaId,
        );
        return target ? { ref: target } : {};
      }
      case "register-request": {
        if (
          !this.get("SELECT 1 FROM work_messages WHERE id=?", command.messageId)
        )
          throw new WorkError("That message is no longer there.");
        // A retry registers the same reference again; nothing changes.
        this.run(
          "INSERT OR IGNORE INTO work_requests(ref,message_id,project_area_id,updated_at) VALUES (?,?,?,?)",
          command.ref,
          command.messageId,
          command.projectAreaId,
          now,
        );
        return { ref: command.ref };
      }
      case "request-report": {
        const row = this.get(
          "SELECT status,seen_json FROM work_requests WHERE ref=?",
          command.ref,
        );
        // Never guess: a report for a reference Amun never gave is refused,
        // and the request it might belong to keeps its confirmed status.
        if (!row) throw new WorkError("No request has that reference.");
        const seen: string[] = list(row.seen_json).map(String);
        if (seen.includes(command.fingerprint)) return { ref: command.ref };
        // A delayed progress report cannot reopen a delivered request.
        if (row.status === "delivered" && command.status !== "delivered")
          return { ref: command.ref };
        this.run(
          "UPDATE work_requests SET status=?,role=?,detail=?,parts=max(parts,?),updated_at=?,seen_json=? WHERE ref=?",
          command.status,
          this.clean(command.role),
          this.clean(command.detail),
          command.parts,
          now,
          JSON.stringify([...seen, command.fingerprint].slice(-50)),
          command.ref,
        );
        return { ref: command.ref };
      }
      case "record-firstmate-reply": {
        const ref = recordFirstMateReply(this, command.text, command.model);
        if (!ref)
          throw new WorkError("There is no chat for this Firstmate reply.");
        return { ref };
      }
      case "start-delivery": {
        const area = this.get(
          "SELECT type,name,product_id,delivery FROM work_areas WHERE id=? AND status<>'deleted'",
          command.workAreaId,
        );
        if (!area) throw new WorkError("That work area no longer exists.");
        if (area.type !== "project" && area.type !== "product")
          throw new WorkError(
            "Only a product or a project can run with stories and sprints.",
          );
        let productId = (area.product_id as string | null) ?? null;
        if (area.delivery === 1 && productId) return { ref: productId };
        if (!productId) {
          productId = randomUUID();
          this.run(
            "INSERT INTO products(id,name,allowed_models_json,created_at) VALUES (?,?,'[]',?)",
            productId,
            String(area.name),
            now,
          );
        }
        this.run(
          "UPDATE work_areas SET product_id=?,delivery=1 WHERE id=?",
          productId,
          command.workAreaId,
        );
        // The checklist's tasks become stories, Done kept (§3.2). The
        // checklist itself stays in the Library as it was.
        const checklist = this.get(
          "SELECT o.body FROM library_outputs o JOIN library_output_links l ON l.output_id=o.id WHERE l.work_area_id=? AND o.type='project_checklist' AND o.status<>'Archived' ORDER BY o.updated_at DESC LIMIT 1",
          command.workAreaId,
        );
        for (const task of parseProjectChecklist(String(checklist?.body ?? "")))
          this.run(
            "INSERT INTO work_items(id,product_id,type,title,body,status) VALUES (?,?,'story',?,?,?)",
            randomUUID(),
            productId,
            this.clean(task.title),
            [
              task.owner && `Owner: ${task.owner}`,
              task.due && `Due: ${task.due}`,
            ]
              .filter(Boolean)
              .join("\n"),
            task.done ? storyStatusWords.done : storyStatusWords.todo,
          );
        return { ref: productId };
      }
      case "set-story-status": {
        const item = this.get(
          "SELECT type,remote_system FROM work_items WHERE id=?",
          command.itemId,
        );
        if (!item) throw new WorkError("That story no longer exists.");
        if (item.remote_system)
          throw new WorkError(
            "This story is worked in a connected tool, so its status changes there, through an approved plan.",
          );
        this.run(
          "UPDATE work_items SET status=? WHERE id=?",
          storyStatusWords[command.status],
          command.itemId,
        );
        return { ref: command.itemId };
      }
      case "link-delivery": {
        if (command.linked)
          this.run(
            "INSERT OR IGNORE INTO delivery_links(kind,from_id,to_id,created_at) VALUES (?,?,?,?)",
            command.link,
            command.fromId,
            command.toId,
            now,
          );
        else
          this.run(
            "DELETE FROM delivery_links WHERE kind=? AND from_id=? AND to_id=?",
            command.link,
            command.fromId,
            command.toId,
          );
        return { ref: command.fromId };
      }
      case "close-out-release": {
        const release = this.get(
          "SELECT o.body,l.work_area_id FROM library_outputs o JOIN library_output_links l ON l.output_id=o.id WHERE o.id=? AND o.type='release_tracker'",
          command.releaseId,
        );
        if (!release) throw new WorkError("That release no longer exists.");
        if (
          !releaseBodyIsLive(String(release.body), String(release.work_area_id))
        )
          throw new WorkError(
            "Close-out starts once the release is Verified live.",
          );
        const stories = this.all(
          "SELECT w.id,w.title,w.status,w.remote_system,w.remote_id FROM delivery_links d JOIN work_items w ON w.id=d.to_id WHERE d.kind='release_story' AND d.from_id=?",
          command.releaseId,
        );
        let closed = 0;
        const inTool: { id: string; title: string; key: string | null }[] = [];
        for (const story of stories) {
          const group = storyGroup(story.status as string | null);
          if (group === "done" || group === "removed") continue;
          if (story.remote_system) {
            inTool.push({
              id: String(story.id),
              title: String(story.title),
              key: (story.remote_id as string | null) ?? null,
            });
            continue;
          }
          this.run(
            "UPDATE work_items SET status=? WHERE id=?",
            storyStatusWords.done,
            story.id,
          );
          closed++;
        }
        return { ref: command.releaseId, step: { closed, inTool } };
      }
      case "mark-delivered": {
        const area = this.get(
          "SELECT product_id FROM work_areas WHERE id=? AND status<>'deleted'",
          command.workAreaId,
        );
        const productId = (area?.product_id as string | null) ?? null;
        if (!productId)
          throw new WorkError(
            "Only a product, or a project with stories, can be delivered.",
          );
        // Bound to each requirements document's current version, which must
        // be the one the captain approved (review on #69).
        const prds = this.all(
          "SELECT p.id,p.objective_id,p.version,(SELECT count(*) FROM prd_versions v JOIN approvals a ON a.prd_version_id=v.id AND a.decision='approved' WHERE v.prd_id=p.id AND v.version=p.version) AS approved FROM prds p WHERE p.product_id=?",
          productId,
        );
        if (!prds.length)
          throw new WorkError("There are no requirements to deliver yet.");
        const unapproved = prds.find((prd) => Number(prd.approved) === 0);
        if (unapproved)
          throw new WorkError(
            `Not delivered yet: version ${String(unapproved.version)} of the requirements is not approved.`,
          );
        // The stories drafted from those approved versions, with their epics;
        // with no drafting record, every story of this work counts.
        const items = this.all(
          "SELECT id,type,status,parent_id FROM work_items WHERE product_id=?",
          productId,
        );
        const drafted = new Set(
          this.all(
            `SELECT d.item_id FROM story_drafts d JOIN prds p ON p.objective_id=d.objective_id AND p.version=d.prd_version WHERE p.product_id=?`,
            productId,
          ).map((row) => String(row.item_id)),
        );
        const inScope = (item: Record<string, unknown>) =>
          !drafted.size || drafted.has(String(item.id));
        const epics = items
          .filter((item) => String(item.type).toLowerCase() === "epic")
          .map((epic) => ({
            id: String(epic.id),
            deferred: storyGroup(epic.status as string) === "removed",
            stories: items
              .filter((item) => item.parent_id === epic.id && inScope(item))
              .map((item) => ({
                id: String(item.id),
                status: item.status as string,
              })),
          }))
          .filter((epic) => epic.stories.length > 0 || epic.deferred);
        const scoped = new Set(
          epics.flatMap((epic) => epic.stories.map((story) => story.id)),
        );
        // A live release that ships at least one of those stories.
        const live = this.all(
          "SELECT DISTINCT o.id,o.body FROM library_outputs o JOIN delivery_links d ON d.kind='release_story' AND d.from_id=o.id WHERE o.type='release_tracker' AND o.status<>'Archived'",
        ).some(
          (row) =>
            this.all(
              "SELECT to_id FROM delivery_links WHERE kind='release_story' AND from_id=?",
              row.id,
            ).some((link) => scoped.has(String(link.to_id))) &&
            releaseBodyIsLive(String(row.body), command.workAreaId),
        );
        if (!canProposeDelivered(epics, live))
          throw new WorkError(
            live
              ? "Not delivered yet: every epic must be Done or moved to a later version."
              : "Not delivered yet: a release that ships these stories must be Verified live first.",
          );
        for (const prd of prds)
          this.run(
            "UPDATE prds SET delivered_at=?,delivered_version=? WHERE id=?",
            now,
            prd.version,
            prd.id,
          );
        return { ref: productId };
      }
      case "apply-reply": {
        if (!this.live(command.workAreaId))
          throw new WorkError("That work area no longer exists.");
        const { visible, reports, documents, moves, plans, unmatched } =
          readRequestBlocks(command.text);
        const raising = command.raisePlans ? plans : [];
        // A PRD answer relayed early can arrive again through the normal
        // watcher. Only suppress the repeated plaintext completion.
        const completion = reports.length === 1 ? reports[0] : null;
        const completedRequest =
          command.saveText &&
          !documents.length &&
          !moves.length &&
          !raising.length &&
          !unmatched.length &&
          completion?.status === "delivered"
            ? this.get(
                "SELECT status,seen_json FROM work_requests WHERE ref=?",
                completion.request,
              )
            : undefined;
        const prdRelayMarker = "prd-completion-relayed";
        if (
          completedRequest?.status === "delivered" &&
          (command.prdRelay ||
            list(completedRequest.seen_json).includes(prdRelayMarker))
        )
          return {};
        // Where a request's own message is now, after any move or split.
        const request = (ref: string | null) => {
          if (!ref) return null;
          const row = this.get(
            "SELECT r.ref,r.project_area_id,m.work_area_id,m.chat_id FROM work_requests r JOIN work_messages m ON m.id=r.message_id JOIN work_areas a ON a.id=m.work_area_id WHERE r.ref=? AND a.status<>'deleted'",
            ref,
          );
          return row
            ? {
                ref: String(row.ref),
                project: (row.project_area_id as string | null) ?? null,
                areaId: String(row.work_area_id),
                chatId: (row.chat_id as string | null) ?? null,
              }
            : null;
        };
        const here = { areaId: command.workAreaId, chatId: command.chatId };
        const say = (
          at: { areaId: string; chatId: string | null },
          role: "firstmate" | "card",
          text: string,
          card: unknown = null,
        ) =>
          this.apply({
            version: 1,
            kind: "work",
            action: "message",
            workAreaId: at.areaId,
            chatId: at.chatId,
            role,
            text,
            card: card as never,
            model: role === "firstmate" ? command.model : null,
          } as never);
        // Reports for a reference Amun gave. Any other changes no request,
        // but its words are still shown where the reply arrived.
        const loose = [...unmatched];
        for (const report of reports) {
          if (!request(report.request)) {
            loose.push(report);
            continue;
          }
          this.apply({
            version: 1,
            kind: "work",
            action: "request-report",
            ref: report.request,
            status: report.status,
            role: report.role,
            detail: report.text,
            parts: report.parts,
            fingerprint: reportFingerprint(report),
          } as never);
        }
        // Firstmate's answer to a change of project the owner asked for. It
        // settles only a change that is waiting, for the project asked for.
        for (const move of moves) {
          const row = this.get(
            "SELECT r.change_state,a.name FROM work_requests r LEFT JOIN work_areas a ON a.id=r.change_to_area_id WHERE r.ref=?",
            move.request,
          );
          if (!row || row.change_state !== "requested") continue;
          const asked = row.name === null ? "" : String(row.name);
          if (
            move.accepted &&
            asked.trim().toLowerCase() !== move.project.trim().toLowerCase()
          )
            continue;
          this.apply({
            version: 1,
            kind: "work",
            action: "request-change-result",
            ref: move.request,
            accepted: move.accepted,
          } as never);
        }
        if (command.prdRelay && completedRequest && completion) {
          const row = this.get(
            "SELECT seen_json FROM work_requests WHERE ref=?",
            completion.request,
          );
          this.run(
            "UPDATE work_requests SET seen_json=? WHERE ref=?",
            JSON.stringify(
              [...list(row?.seen_json), prdRelayMarker].slice(-50),
            ),
            completion.request,
          );
        }
        const looseWords = loose.map(reportWords).join("\n");
        // Firstmate's words first, then what it delivered.
        if (looseWords && !command.saveText) say(here, "firstmate", looseWords);
        if (command.saveText && looseWords)
          say(
            here,
            "firstmate",
            [visible, looseWords].filter(Boolean).join("\n\n"),
          );
        else if (command.saveText && visible) {
          const places = new Set(
            [
              ...reports.map((report) => report.request),
              ...documents.flatMap((document) =>
                document.request ? [document.request] : [],
              ),
            ].flatMap((ref) => {
              const known = request(ref);
              return known ? [`${known.areaId}:${known.chatId ?? ""}`] : [];
            }),
          );
          const only = places.size === 1 ? [...places][0]! : null;
          const [areaId, chatId] = only ? only.split(":") : [];
          say(
            only ? { areaId: areaId!, chatId: chatId || null } : here,
            "firstmate",
            visible,
            {
              kind: "request-reply",
              refs: reports
                .filter(
                  (report) =>
                    report.status === "delivered" && request(report.request),
                )
                .map((report) => report.request),
            },
          );
        }
        // Plans in a reply nobody asked for (handoff item 9, 23 November
        // 2026): raised through the same checks as the window, in the chat of
        // the request they name, else where the reply's reports went, else
        // where it arrived. The same plan arriving again is raised once.
        const reported = [
          ...new Set(
            reports.flatMap((report) => {
              const known = request(report.request);
              return known ? [`${known.areaId}:${known.chatId ?? ""}`] : [];
            }),
          ),
        ];
        const reportedAt =
          reported.length === 1
            ? {
                areaId: reported[0]!.split(":")[0]!,
                chatId: reported[0]!.split(":")[1] || null,
              }
            : null;
        for (const plan of raising) {
          const known = request(plan.request);
          const at = known ?? reportedAt ?? here;
          // The whole plan, without the ids Amun gives its items: a replay is
          // the same plan, but a revision (other fields, kind) is reviewed
          // again.
          const payload = (
            kind: unknown,
            items: { summary: string; fields: Record<string, unknown> }[],
          ) =>
            JSON.stringify([
              kind,
              items.map((item) => [
                item.summary,
                Object.entries(item.fields ?? {}).sort(([a], [b]) =>
                  a.localeCompare(b),
                ),
              ]),
            ]);
          const wanted = payload(plan.planKind, plan.items);
          const raised = this.all(
            "SELECT kind,items_json FROM work_plans WHERE work_area_id=? AND destination=? AND summary=?",
            at.areaId,
            plan.destination,
            this.clean(plan.summary),
          ).some((row) => {
            try {
              return (
                payload(
                  row.kind,
                  JSON.parse(String(row.items_json)) as {
                    summary: string;
                    fields: Record<string, unknown>;
                  }[],
                ) === wanted
              );
            } catch {
              return false;
            }
          });
          if (raised) continue;
          const proposal = workCommand.safeParse({
            version: 1,
            kind: "work",
            action: "propose-plan",
            groupId: null,
            workAreaId: at.areaId,
            planKind: plan.planKind,
            destination: plan.destination,
            summary: plan.summary,
            items: plan.items.map((item) => ({ id: randomUUID(), ...item })),
            chatId: at.chatId,
            requestRef:
              known?.ref ??
              (reportedAt && reports.length === 1 ? reports[0]!.request : null),
          });
          let refused = proposal.success
            ? ""
            : "Amun could not read the plan Firstmate wrote.";
          if (proposal.success)
            try {
              this.apply(
                proposal.data as Exclude<WorkCommand, { action: "snapshot" }>,
              );
            } catch (error) {
              if (!(error instanceof WorkError)) throw error;
              refused = error.message;
            }
          // A refused plan never exists; say so where it would have been, so
          // Firstmate is told with the owner's next message there.
          if (refused)
            say(
              at,
              "firstmate",
              `Nothing was raised for your approval. ${refused}`,
              { kind: "plan-refused" },
            );
        }
        for (const document of documents) {
          const known = request(document.request);
          // A matched result lands with its request; anything else where the
          // reply arrived, as before.
          const at = known ?? here;
          // The project card gets it only for a confirmed match; an
          // unmatched document stays in the chat, linked to no card.
          const owner = known ? known.project : null;
          const group = this.groupOf(owner ?? at.areaId);
          // A revision of this same delivery: the same request (or, without
          // one, the same chat) and title. Other requests are never touched.
          const earlier = this.all(
            known
              ? "SELECT card_json FROM work_messages WHERE role='card' AND instr(card_json,'\"delivered\"')>0 AND instr(card_json,?)>0 ORDER BY created_at DESC,rowid DESC"
              : `SELECT card_json FROM work_messages WHERE role='card' AND instr(card_json,'"delivered"')>0 AND work_area_id=? AND ${at.chatId === null ? "chat_id IS NULL" : "chat_id=?"} ORDER BY created_at DESC,rowid DESC`,
            ...(known
              ? [known.ref]
              : [at.areaId, ...(at.chatId === null ? [] : [at.chatId])]),
          )
            .map((row) => {
              try {
                return JSON.parse(String(row.card_json)) as {
                  outputId?: string;
                  title?: string;
                  request?: string | null;
                };
              } catch {
                return {};
              }
            })
            .find(
              (card) =>
                (card.request ?? null) === (known ? known.ref : null) &&
                (card.title ?? "").trim().toLowerCase() ===
                  document.title.trim().toLowerCase(),
            );
          const same = earlier?.outputId
            ? this.get(
                "SELECT id,body FROM library_outputs WHERE id=?",
                earlier.outputId,
              )
            : undefined;
          const body = this.clean(document.body);
          // The same version delivered again is not a second reply.
          if (same && String(same.body) === body) continue;
          const saved = this.apply({
            version: 1,
            kind: "work",
            action: "save-output",
            ...(same ? { outputId: String(same.id) } : {}),
            groupId: group,
            type: document.type,
            title: document.title,
            body,
            status: "Draft",
            workAreaIds: owner ? [owner] : [],
            author: "firstmate",
          } as never);
          const outputId = String(saved.ref);
          const version = Number(
            this.get(
              "SELECT max(version) AS v FROM library_output_versions WHERE output_id=?",
              outputId,
            )?.v ?? 1,
          );
          say(at, "card", document.title, {
            kind: "delivered",
            outputId,
            title: document.title,
            version,
            request: known ? known.ref : null,
          });
        }
        return {};
      }
      case "request-change": {
        if (!this.get("SELECT 1 FROM work_requests WHERE ref=?", command.ref))
          throw new WorkError("No request has that reference.");
        this.run(
          "UPDATE work_requests SET change_to_area_id=?,change_state='requested',updated_at=? WHERE ref=?",
          command.toAreaId,
          now,
          command.ref,
        );
        return { ref: command.ref };
      }
      case "request-change-result": {
        const row = this.get(
          "SELECT change_to_area_id,change_state FROM work_requests WHERE ref=?",
          command.ref,
        );
        if (!row || row.change_state !== "requested")
          throw new WorkError("No change of project is waiting for that.");
        if (command.accepted)
          this.run(
            "UPDATE work_requests SET project_area_id=?,change_to_area_id=NULL,change_state='',updated_at=? WHERE ref=?",
            row.change_to_area_id,
            now,
            command.ref,
          );
        else
          this.run(
            "UPDATE work_requests SET change_state='refused',updated_at=? WHERE ref=?",
            now,
            command.ref,
          );
        return { ref: command.ref };
      }
      case "keep-here": {
        const area = this.get(
          "SELECT kept_here_json FROM work_areas WHERE id=? AND status<>'deleted'",
          command.workAreaId,
        );
        if (!area) throw new WorkError("That work area no longer exists.");
        const kept: string[] = list(area.kept_here_json).map(String);
        const name = this.clean(command.name);
        if (!kept.some((item) => sameWorkName(item, name)))
          this.run(
            "UPDATE work_areas SET kept_here_json=? WHERE id=?",
            JSON.stringify([...kept, name].slice(-200)),
            command.workAreaId,
          );
        return {};
      }
      case "settle-card": {
        const card = this.get(
          "SELECT 1 FROM work_messages WHERE id=? AND role='card'",
          command.messageId,
        );
        if (!card) throw new WorkError("That card is no longer there.");
        this.run(
          "UPDATE work_messages SET card_json=? WHERE id=?",
          JSON.stringify(command.card),
          command.messageId,
        );
        return {};
      }
    }
  }

  /** The work is live and the chat (null is its first chat) belongs to it. */
  private requireChat(workAreaId: string, chatId: string | null) {
    if (!this.live(workAreaId))
      throw new WorkError("That work area no longer exists.");
    if (
      chatId !== null &&
      !this.get(
        "SELECT 1 FROM work_chats WHERE id=? AND work_area_id=?",
        chatId,
        workAreaId,
      )
    )
      throw new WorkError("That chat no longer exists.");
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
    // A message that names its own group ("for work") is not asked again.
    const groupId =
      command.groupId ??
      setup.activeGroupId ??
      groupMentioned(command.text, groups);
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
    if (step.step === "reminder")
      return { ...this.reminders.request(command.text, null), step };
    if (step.step === "unreadable")
      return {
        ok: false,
        message:
          "I could not read that. Your file is kept; try pasting the text or another format.",
        step,
      };
    return { step: { ...step, title, groupId: resolvedGroup } };
  }

  private approvePlan(planId: string, fingerprint: string, itemIds?: string[]) {
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
    if (itemIds) {
      const chosen = new Set(itemIds);
      if (itemIds.some((id) => !current.items.some((item) => item.id === id)))
        throw new WorkError("Those items are not in this plan.");
      const rest = current.items.filter((item) => !chosen.has(item.id));
      if (rest.length) {
        // Approval covers exactly the ticked items. The others are not
        // approved: they wait in their own proposal.
        current.items = current.items.filter((item) => chosen.has(item.id));
        row.items_json = JSON.stringify(current.items);
        this.run(
          "UPDATE work_plans SET items_json=? WHERE id=?",
          row.items_json,
          planId,
        );
        const waiting = randomUUID();
        this.run(
          "INSERT INTO work_plans(id,group_id,work_area_id,kind,destination,summary,items_json,state,created_at,split_from) VALUES (?,?,?,?,?,?,?,'proposed',?,?)",
          waiting,
          row.group_id,
          row.work_area_id,
          row.kind,
          row.destination,
          row.summary,
          JSON.stringify(rest),
          now,
          planId,
        );
        this.attend({
          kind: "approval",
          groupId: (row.group_id as string | null) ?? null,
          workAreaId: (row.work_area_id as string | null) ?? null,
          title:
            rest.length === 1
              ? rest[0]!.summary
              : `${rest.length} changes not approved yet`,
          detail: "Left out of your last approval; still waiting for you",
          ref: "plan:" + waiting,
        });
      }
    }
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

  /**
   * An item an old plan failed to create may since have been published by
   * another plan in the same work area. It is then linked to that item, so the
   * old plan stops reporting it as unpublished and a retry cannot create it
   * again.
   */
  private resolveSuperseded() {
    let plans: Record<string, unknown>[];
    try {
      plans = this.all(
        "SELECT id,work_area_id,destination,approved_json,results_json FROM work_plans WHERE state IN ('failed','partial') AND results_json IS NOT NULL",
      );
    } catch {
      return;
    }
    for (const plan of plans) {
      const failed = (
        list(plan.results_json) as { id: string; state: string }[]
      ).filter((result) => result.state === "failed");
      if (!failed.length) continue;
      const items = list(plan.approved_json) as {
        id: string;
        summary: string;
        fields: Record<string, string | number | null>;
      }[];
      let others: Record<string, unknown>[];
      try {
        others = this.all(
          `SELECT w.item_id,w.external_id,w.url,p.approved_json FROM plan_writes w JOIN work_plans p ON p.id=w.plan_id
           WHERE w.plan_id<>? AND w.state='created' AND w.external_id IS NOT NULL AND p.work_area_id IS ?
           AND w.destination=? ORDER BY p.created_at,w.rowid`,
          String(plan.id),
          (plan.work_area_id as string | null) ?? null,
          "ado",
        );
      } catch {
        continue;
      }
      if (!others.length || plan.destination !== "ado") continue;
      const found: {
        id: string;
        state: "created";
        externalId: string;
        url?: string;
        linked: true;
      }[] = [];
      for (const result of failed) {
        const item = items.find((entry) => entry.id === result.id);
        if (!item || adoWorkItemOf(item.fields).named) continue;
        const key = planItemKey(item);
        const match = others.find((other) => {
          const before = (list(other.approved_json) as typeof items).find(
            (entry) => entry.id === other.item_id,
          );
          if (!before) return false;
          const then = planItemKey(before);
          return sameItem(then, key);
        });
        if (match)
          found.push({
            id: result.id,
            state: "created",
            externalId: String(match.external_id),
            ...(match.url ? { url: String(match.url) } : {}),
            linked: true,
          });
      }
      if (!found.length) continue;
      for (const result of found)
        this.run(
          "UPDATE plan_writes SET state='created',external_id=?,url=?,note=? WHERE plan_id=? AND item_id=?",
          result.externalId,
          result.url ?? null,
          `Already exists as #${result.externalId}; linked, not created.`,
          String(plan.id),
          result.id,
        );
      this.recordResults(String(plan.id), found);
    }
  }

  private recordResults(
    planId: string,
    results: {
      id: string;
      state: "created" | "failed" | "unknown";
      externalId?: string | undefined;
      url?: string | undefined;
      linked?: boolean | undefined;
      updated?: boolean | undefined;
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
          result.state === "created" && result.linked
            ? `Already exists: ${result.externalId ? "#" + result.externalId + " " : ""}${item.summary}`
            : result.state === "created" && result.updated
              ? `Updated ${item.summary}`
              : result.state === "created"
                ? `Created ${result.externalId ? "#" + result.externalId + " " : ""}${item.summary}`
                : result.state === "failed"
                  ? `Not created: ${item.summary}`
                  : `Checking whether this was created: ${item.summary}`,
        state: result.state === "created" ? "finished" : "failed",
        ref: "plan:" + planId,
      });
    }
    this.closeAttention("failure:" + planId);
    this.publishReceipt(planId, approved.items, all, state);
    const named = (state: "failed" | "unknown") =>
      all
        .filter((result) => result.state === state)
        .map(
          (result) =>
            approved.items.find((entry) => entry.id === result.id)?.summary ??
            "An item",
        );
    if (!complete)
      this.attend({
        kind: "failure",
        groupId,
        workAreaId,
        title: "Some approved changes were not published",
        detail: failureDetail(
          named("failed"),
          named("unknown"),
          this.writeNote(planId, all.find((r) => r.state === "failed")?.id),
        ),
        ref: "failure:" + planId,
        options: summary.button ? [summary.button] : [],
      });
    return { ref: planId, step: { ...summary, state } };
  }

  /**
   * A published epic or story becomes Published in this work's story list:
   * the draft with the same title gets the tool and key; anything else is
   * added. Sprints and other kinds are left out.
   */
  private recordPublished(
    areaId: string,
    tool: string,
    rows: {
      summary: string;
      type: string | null;
      parent: string | null;
      state: string;
      key: string | null;
    }[],
  ) {
    const area = this.get(
      "SELECT product_id FROM work_areas WHERE id=?",
      areaId,
    );
    const productId = (area?.product_id as string | null) ?? null;
    if (!productId) return;
    const ids = new Map<string, string>();
    for (const row of rows) {
      if (row.state !== "created" || !row.key) continue;
      const kind = (row.type ?? "story").toLowerCase();
      if (!["epic", "story", "task", "bug"].includes(kind)) continue;
      const existing = this.get(
        "SELECT id FROM work_items WHERE product_id=? AND (remote_id=? OR (remote_id IS NULL AND lower(title)=lower(?))) ORDER BY remote_id IS NULL LIMIT 1",
        productId,
        row.key,
        row.summary,
      );
      const parent = row.parent
        ? (ids.get(row.parent.toLowerCase()) ?? null)
        : null;
      if (existing) {
        this.run(
          "UPDATE work_items SET remote_system=?,remote_id=?,parent_id=coalesce(parent_id,?),status=CASE WHEN lower(status) IN ('draft','') THEN 'To do' ELSE status END WHERE id=?",
          tool,
          row.key,
          parent,
          existing.id,
        );
        ids.set(row.summary.toLowerCase(), String(existing.id));
      } else {
        const id = randomUUID();
        this.run(
          "INSERT INTO work_items(id,product_id,type,title,parent_id,status,remote_system,remote_id) VALUES (?,?,?,?,?,'To do',?,?)",
          id,
          productId,
          kind,
          row.summary,
          parent,
          tool,
          row.key,
        );
        ids.set(row.summary.toLowerCase(), id);
      }
    }
  }

  /**
   * One receipt per approved plan, in the chat of the request that asked
   * (else the chat the plan was raised in), updated in place as results
   * arrive (Idea to Done §4.8, approved 23 November 2026). The request turns
   * Ready only when everything was created.
   */
  private publishReceipt(
    planId: string,
    items: { id: string; summary: string; fields: Record<string, unknown> }[],
    results: {
      id: string;
      state: "created" | "failed" | "unknown";
      externalId?: string | undefined;
      url?: string | undefined;
    }[],
    state: "published" | "partial" | "failed",
  ) {
    const plan = this.get(
      "SELECT work_area_id,chat_id,request_ref,destination FROM work_plans WHERE id=?",
      planId,
    );
    if (!plan) return;
    const ref = (plan.request_ref as string | null) ?? null;
    const asked = ref
      ? this.get(
          "SELECT m.work_area_id,m.chat_id FROM work_requests r JOIN work_messages m ON m.id=r.message_id JOIN work_areas a ON a.id=m.work_area_id WHERE r.ref=? AND a.status<>'deleted'",
          ref,
        )
      : undefined;
    const areaId =
      (asked?.work_area_id as string | undefined) ??
      (plan.work_area_id as string | null);
    if (!areaId || !this.live(areaId)) return;
    const chatId = asked
      ? ((asked.chat_id as string | null) ?? null)
      : ((plan.chat_id as string | null) ?? null);
    const byId = new Map(results.map((result) => [result.id, result]));
    const rows = items.map((item) => {
      const result = byId.get(item.id);
      const parent = item.fields.parent;
      return {
        summary: item.summary,
        type: typeof item.fields.type === "string" ? item.fields.type : null,
        parent: typeof parent === "string" && parent ? parent : null,
        state: result?.state ?? "unknown",
        key: result?.externalId ?? null,
        url: result?.url ?? null,
        note:
          result?.state === "failed" ? this.writeNote(planId, item.id) : null,
      };
    });
    const created = rows.filter((row) => row.state === "created").length;
    this.recordPublished(areaId, String(plan.destination), rows);
    const card = {
      kind: "publish-receipt",
      planId,
      destination: String(plan.destination),
      request: ref,
      state,
      created,
      total: rows.length,
      items: rows.slice(0, 200),
    };
    const text = `Created in ${String(plan.destination)}: ${created} of ${rows.length}`;
    const existing = this.get(
      "SELECT id FROM work_messages WHERE role='card' AND instr(card_json,'\"publish-receipt\"')>0 AND instr(card_json,?)>0",
      JSON.stringify(planId),
    );
    if (existing)
      this.run(
        "UPDATE work_messages SET card_json=?,text=? WHERE id=?",
        JSON.stringify(card),
        text,
        existing.id,
      );
    else
      this.apply({
        version: 1,
        kind: "work",
        action: "message",
        workAreaId: areaId,
        chatId,
        role: "card",
        text,
        card: card as never,
        model: null,
      } as never);
    if (ref && this.get("SELECT 1 FROM work_requests WHERE ref=?", ref))
      this.apply({
        version: 1,
        kind: "work",
        action: "request-report",
        ref,
        status:
          state === "published"
            ? "delivered"
            : state === "partial"
              ? "needs-decision"
              : "failed",
        role: "Amun",
        detail:
          state === "published"
            ? `Created ${created} items in ${String(plan.destination)}`
            : `${created} of ${rows.length} created in ${String(plan.destination)}`,
        parts: 0,
        fingerprint: `receipt:${planId}:${state}:${created}`,
      } as never);
  }

  /** Why the destination refused an item, as the publisher recorded it. */
  private writeNote(planId: string, itemId: string | undefined) {
    if (!itemId) return null;
    try {
      const row = this.get(
        "SELECT note FROM plan_writes WHERE plan_id=? AND item_id=?",
        planId,
        itemId,
      );
      return typeof row?.note === "string" && row.note ? row.note : null;
    } catch {
      // Results can be recorded without the publisher's table in play.
      return null;
    }
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
  const named = agentCatalog.find(
    (agent) => agent.name.toLowerCase() === description.trim().toLowerCase(),
  );
  if (named) return named.name;
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
