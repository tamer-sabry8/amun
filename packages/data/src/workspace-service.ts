import { portfolio, dependencies } from "./portfolio.ts";
import { ModelRouting } from "./model-routing.ts";
import { StoryDecisions } from "./story-decisions.ts";
import { riceScore, type RiceInputs } from "../../domain/src/rice.ts";
import { ProductDocuments, AuthoringError } from "./product-documents.ts";
import { ProductAuthoring, type ProductModel } from "./product-authoring.ts";
import { extractDocument, DocumentInputError } from "./document-import.ts";
import { createHash, randomUUID } from "node:crypto";
import { Redactor } from "../../security/src/redaction.ts";
import type Database from "better-sqlite3";
import {
  productAuthoring,
  documentImport,
  workspaceCommand,
  workspaceSnapshot,
  uiPreferences,
  type WorkspaceSnapshot,
  type WorkspaceEvent,
} from "../../contracts/src/workspace.ts";
import type { StatusActivity } from "../../contracts/src/entities.ts";
import { AttentionStore, searchEntities } from "./attention-store.ts";
export class WorkspaceService {
  private readonly db: Database.Database;
  private readonly authoring: ProductAuthoring;
  private readonly documents: ProductDocuments;
  private readonly attention: AttentionStore;
  private readonly redactor: Redactor;
  constructor(db: Database.Database, redactor = new Redactor()) {
    this.db = db;
    this.redactor = redactor;
    this.authoring = new ProductAuthoring(
      db,
      () => this.preferences().productId,
      redactor,
    );
    this.documents = new ProductDocuments(db);
    this.attention = new AttentionStore(db);
  }
  private preferences() {
    const row = this.db
      .prepare(
        "SELECT value_json FROM workspace_settings WHERE id='ui_preferences'",
      )
      .get() as { value_json: string } | undefined;
    return uiPreferences.parse(row ? JSON.parse(row.value_json) : {});
  }
  private savePreferences(preferences: WorkspaceSnapshot["preferences"]) {
    this.db
      .prepare(
        "INSERT INTO workspace_settings(id,value_json) VALUES ('ui_preferences',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
      )
      .run(JSON.stringify(preferences));
  }
  private productContext(productId: string | null) {
    if (!productId) return null;
    const product = this.db
      .prepare("SELECT allowed_models_json FROM products WHERE id=?")
      .get(productId) as { allowed_models_json: string } | undefined;
    if (!product) return null;
    const sources = this.db
      .prepare(
        "SELECT id,title,kind,external_id AS reference FROM sources WHERE product_id=? ORDER BY title,id",
      )
      .all(productId);
    const memoryRows = this.db
      .prepare(
        `
      SELECT m.id,m.source_id AS sourceId,m.type,m.data_json
      FROM memory_entities m JOIN sources s ON s.id=m.source_id AND s.product_id=m.product_id
      WHERE m.product_id=? ORDER BY m.id`,
      )
      .all(productId) as {
      id: string;
      sourceId: string;
      type: string;
      data_json: string;
    }[];
    return {
      productId,
      sources,
      routes: new ModelRouting(this.db).list(productId),
      modelRuns: new ModelRouting(this.db).recent(productId),
      routingReviews: new ModelRouting(this.db).pending(productId),
      storyDecisions: new StoryDecisions(this.db).list(productId),
      storyDrafts: this.db
        .prepare(
          `SELECT w.id,w.title,w.type,w.parent_id AS parentId,w.status,w.acceptance_json,s.objective_id AS objectiveId,s.prd_version AS version,s.requirement_text AS requirement,s.requirement_id AS requirementId FROM work_items w JOIN story_drafts s ON s.item_id=w.id WHERE w.product_id=? ORDER BY w.rowid`,
        )
        .all(productId)
        .map((raw) => {
          const { acceptance_json, ...fields } = raw as Record<string, string>;
          return { ...fields, acceptance: JSON.parse(acceptance_json!) };
        }),
      priorities: (
        this.db
          .prepare(
            "SELECT id,objective,release,status,evidence,reach,impact,confidence,effort FROM priorities WHERE product_id=? ORDER BY objective,id",
          )
          .all(productId) as (RiceInputs & { id: string })[]
      )
        .map((row) => ({ ...row, score: riceScore(row) }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
      objectives: this.documents.objectives(productId),
      allowedModels: JSON.parse(product.allowed_models_json),
      memory: memoryRows.map(({ data_json, ...row }) => ({
        ...row,
        data: JSON.parse(data_json),
      })),
    };
  }
  snapshot(): WorkspaceSnapshot {
    this.attention.wake(Date.now());
    const activities: StatusActivity[] = [];
    const runs = this.db
      .prepare(
        "SELECT id,product_id,agent_role,state FROM runs WHERE state IN ('queued','running','awaiting_decision','blocked','failed','unknown')",
      )
      .all() as {
      id: string;
      product_id: string;
      agent_role: string;
      state: string;
    }[];
    for (const run of runs)
      activities.push({
        id: "run-" + run.id,
        productId: run.product_id,
        kind: "run",
        state:
          run.state === "running"
            ? "working"
            : run.state === "failed"
              ? "failed"
              : "waiting",
        ref: run.id,
        text: run.agent_role,
      });
    const actions = this.db
      .prepare(
        "SELECT id,product_id,kind,state FROM actions WHERE state IN ('executing','unknown','failed')",
      )
      .all() as {
      id: string;
      product_id: string | null;
      kind: string;
      state: string;
    }[];
    for (const action of actions)
      activities.push({
        id: "action-" + action.id,
        productId: action.product_id,
        kind:
          action.state === "unknown"
            ? "reconciliation"
            : ["publish", "notion_publish"].includes(action.kind)
              ? "publication"
              : "action",
        state:
          action.state === "executing"
            ? "working"
            : action.state === "failed"
              ? "failed"
              : "waiting",
        ref: action.id,
        text: action.kind.replaceAll("_", " "),
      });
    const batches = this.db
      .prepare(
        `SELECT b.id,b.kind,b.product_id,count(*) AS total,sum(a.state='succeeded') AS done,sum(a.state='unknown') AS uncertain,sum(a.state IN ('executing','approved')) AS working FROM ado_batches b JOIN ado_steps s ON s.batch_id=b.id JOIN actions a ON a.id=s.action_id GROUP BY b.id ORDER BY b.rowid DESC LIMIT 50`,
      )
      .all() as {
      id: string;
      kind: string;
      product_id: string;
      total: number;
      done: number;
      uncertain: number;
      working: number;
    }[];
    for (const b of batches)
      activities.push({
        id: "azure-" + b.id,
        productId: b.product_id,
        kind: b.kind === "publish" ? "publication" : "action",
        state:
          b.done === b.total
            ? "completed"
            : b.working && !b.uncertain
              ? "working"
              : "waiting",
        ref: b.id,
        text:
          (b.kind === "publish" ? "Publication" : "Sprint commitment") +
          " · " +
          b.done +
          "/" +
          b.total +
          " verified" +
          (b.uncertain ? " · reconciliation needed" : ""),
      });
    const preferences = this.preferences();
    return workspaceSnapshot.parse({
      version: 1,
      kind: "workspace-snapshot",
      preferences,
      portfolio: preferences.productId ? null : portfolio(this.db),
      productContext: this.productContext(preferences.productId),
      products: this.db
        .prepare("SELECT id,name FROM products ORDER BY created_at,id")
        .all(),
      attention: this.attention.list(preferences.productId),
      activities: activities.filter(
        (item) =>
          !preferences.productId ||
          !item.productId ||
          item.productId === preferences.productId,
      ),
      notifications: this.db
        .prepare(
          "SELECT id,product_id AS productId,kind,text,ref,read_at AS readAt,created_at AS createdAt FROM notifications WHERE (? IS NULL OR product_id=?) ORDER BY created_at DESC,id",
        )
        .all(preferences.productId, preferences.productId),
      artifacts: this.db
        .prepare(
          "SELECT id,product_id AS productId,kind,path_or_uri AS ref FROM artifacts WHERE (? IS NULL OR product_id=?) ORDER BY rowid DESC",
        )
        .all(preferences.productId, preferences.productId),
      skills: this.db
        .prepare(
          "SELECT id,name,version,approved_at AS approvedAt FROM skills ORDER BY name,id",
        )
        .all(),
    });
  }
  async author(
    input: unknown,
    firstmate: ProductModel,
  ): Promise<WorkspaceEvent> {
    try {
      const request = productAuthoring.parse(input);
      await this.authoring.run(request, async (model, instruction, context) => {
        const answer = await firstmate(model, instruction, context);
        new ModelRouting(this.db).record(
          request.productId,
          randomUUID(),
          model,
          request.action,
        );
        return answer;
      });
      return this.snapshot();
    } catch (e) {
      return {
        version: 1,
        kind: "workspace-error",
        message:
          e instanceof AuthoringError
            ? e.message
            : "Firstmate could not complete the sourced interview. Check the selected model connection and retry.",
      };
    }
  }
  async importDocument(input: unknown): Promise<WorkspaceEvent> {
    try {
      const parsed = documentImport.safeParse(input);
      if (!parsed.success)
        throw new DocumentInputError("Choose a supported file up to 8 MiB.");
      const { productId, name, bytes } = parsed.data;
      const verify = () => {
        if (this.preferences().productId !== productId)
          throw new DocumentInputError(
            "Product selection changed. Select the intended product and retry.",
          );
      };
      verify();
      const buffer = Buffer.from(bytes);
      const doc = await extractDocument(name, buffer);
      const title = this.redactor.text(name),
        hash = createHash("sha256").update(buffer).digest("hex");
      this.db
        .transaction(() => {
          verify();
          if (
            this.db
              .prepare(
                "SELECT s.id FROM sources s JOIN source_documents d ON d.source_id=s.id WHERE s.product_id=? AND s.title=? AND s.hash=?",
              )
              .get(productId, title, hash)
          )
            return;
          const id = randomUUID();
          this.db
            .prepare(
              "INSERT INTO sources(id,product_id,kind,title,retrieved_at,hash) VALUES(?,?,?,?,?,?)",
            )
            .run(
              id,
              productId,
              doc.kind,
              title,
              new Date().toISOString(),
              hash,
            );
          this.db
            .prepare(
              "INSERT INTO source_documents(source_id,body,image) VALUES(?,?,?)",
            )
            .run(id, this.redactor.text(doc.body), doc.image);
        })
        .immediate();
      return this.snapshot();
    } catch (e) {
      return {
        version: 1,
        kind: "workspace-error",
        message:
          e instanceof DocumentInputError
            ? e.message
            : "Document import failed.",
      };
    }
  }
  handle(input: unknown): WorkspaceEvent | undefined {
    const parsed = workspaceCommand.safeParse(input);
    if (!parsed.success) return;
    const command = parsed.data;
    try {
      if (command.action === "preferences") {
        if (
          command.preferences.productId !== null &&
          !this.db
            .prepare("SELECT id FROM products WHERE id=?")
            .get(command.preferences.productId)
        )
          throw Error("Unknown product");
        this.savePreferences(command.preferences);
      } else if (command.action === "confirm-dependency") {
        this.db
          .transaction(() => {
            if (
              this.preferences().productId ||
              !dependencies(this.db).some((d) => d.key === command.key)
            )
              throw new AuthoringError(
                "Select a current dependency in Portfolio.",
              );
            this.db
              .prepare(
                "INSERT INTO portfolio_confirmations(evidence_key) VALUES(?) ON CONFLICT DO NOTHING",
              )
              .run(command.key);
          })
          .immediate();
      } else if (command.action === "create-product") {
        this.db
          .transaction(() => {
            const id = randomUUID();
            this.db
              .prepare(
                "INSERT INTO products(id,name,allowed_models_json,created_at) VALUES (?,?,?,?)",
              )
              .run(
                id,
                this.redactor.text(command.name),
                JSON.stringify([
                  ...new Set(
                    command.allowedModels.map((model) =>
                      this.redactor.text(model),
                    ),
                  ),
                ]),
                new Date().toISOString(),
              );
            this.savePreferences({ ...this.preferences(), productId: id });
          })
          .immediate();
      } else if (
        command.action === "save-model-route" ||
        command.action === "approve-model-route"
      ) {
        if (this.preferences().productId !== command.productId)
          throw new AuthoringError("Product selection changed.");
        const routes = new ModelRouting(this.db);
        if (command.action === "save-model-route")
          routes.save({
            productId: command.productId,
            model: command.model,
            task: command.task,
            difficulty: command.difficulty,
          });
        else
          routes.approve(command.productId, command.reviewId, command.binding);
      } else if (command.action === "product-models") {
        if (this.preferences().productId !== command.productId)
          throw new AuthoringError("Product selection changed.");
        this.db
          .prepare("UPDATE products SET allowed_models_json=? WHERE id=?")
          .run(
            JSON.stringify([
              ...new Set(
                command.allowedModels.map((model) => this.redactor.text(model)),
              ),
            ]),
            command.productId,
          );
      } else if (command.action === "map-source") {
        this.db
          .transaction(() => {
            if (this.preferences().productId !== command.productId)
              throw Error("Product selection changed");
            const reference = this.redactor.text(command.reference);
            this.db
              .prepare(
                "INSERT INTO sources(id,product_id,kind,external_id,title,retrieved_at,hash) VALUES (?,?,?,?,?,?,?)",
              )
              .run(
                randomUUID(),
                command.productId,
                command.sourceKind,
                reference,
                this.redactor.text(command.title),
                new Date().toISOString(),
                createHash("sha256").update(reference).digest("hex"),
              );
          })
          .immediate();
      } else if (command.action === "prd-selection") {
        if (this.preferences().productId !== command.productId)
          throw new AuthoringError("Product selection changed.");
        this.documents.annotate(
          command.productId,
          command.objectiveId,
          command.expectedVersion,
          command.intent,
          command.selection,
        );
      } else if (command.action === "save-priority") {
        if (this.preferences().productId !== command.productId)
          throw new AuthoringError("Product selection changed.");
        try {
          riceScore(command);
        } catch (e) {
          throw new AuthoringError((e as Error).message);
        }
        const result = this.db
          .prepare(
            `INSERT INTO priorities(id,product_id,objective,release,status,evidence,reach,impact,confidence,effort) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET objective=excluded.objective,release=excluded.release,status=excluded.status,evidence=excluded.evidence,reach=excluded.reach,impact=excluded.impact,confidence=excluded.confidence,effort=excluded.effort WHERE priorities.product_id=excluded.product_id`,
          )
          .run(
            command.priorityId,
            command.productId,
            this.redactor.text(command.objective),
            this.redactor.text(command.release),
            command.status,
            this.redactor.text(command.evidence),
            command.reach,
            command.impact,
            command.confidence,
            command.effort,
          );
        if (!result.changes)
          throw new AuthoringError("Priority belongs to another product.");
      } else if (
        command.action === "save-prd" ||
        command.action === "approve-prd" ||
        command.action === "apply-proposal" ||
        command.action === "dismiss-proposal"
      ) {
        if (this.preferences().productId !== command.productId)
          throw new AuthoringError("Product selection changed.");
        this.documents.changePrd(
          command.productId,
          command.objectiveId,
          command.expectedVersion,
          command.action,
          "proposalId" in command
            ? command.proposalId
            : this.redactor.text(command.markdown),
        );
      } else if (
        command.action === "save-understanding" ||
        command.action === "approve-understanding"
      ) {
        if (this.preferences().productId !== command.productId)
          throw new AuthoringError("Product selection changed.");
        this.documents.saveUnderstanding(
          command.productId,
          command.objectiveId,
          command.expectedVersion,
          command.action === "save-understanding"
            ? {
                facts: this.redactor.text(command.facts),
                assumptions: this.redactor.text(command.assumptions),
                questions: this.redactor.text(command.questions),
              }
            : null,
        );
      } else if (command.action === "pin-decision") {
        if (this.preferences().productId !== command.productId)
          throw Error("Selection changed");
        const stored = this.db
          .prepare(
            `INSERT INTO memory_entities(id,product_id,type,data_json,source_id,confidence,confirmed,updated_at)
          SELECT ?,product_id,'pinned decision',?,id,1,1,? FROM sources WHERE id=? AND product_id=?`,
          )
          .run(
            randomUUID(),
            JSON.stringify({ text: this.redactor.text(command.text) }),
            new Date().toISOString(),
            command.sourceId,
            command.productId,
          );
        if (!stored.changes) throw Error("Invalid source");
      } else if (command.action === "review-story-decision") {
        if (this.preferences().productId !== command.productId)
          throw new AuthoringError("Product selection changed.");
        new StoryDecisions(this.db).review(
          command.productId,
          command.requestId,
          command.operation,
          this.redactor.text(command.choice),
          this.redactor.text(command.confirmation),
        );
      } else if (command.action === "snooze" || command.action === "resolve") {
        const selected = this.preferences().productId;
        if (selected && this.attention.read(command.id).productId !== selected)
          throw new AuthoringError("Request belongs to a different product.");
        if (
          command.action === "resolve" &&
          this.db
            .prepare("SELECT 1 FROM story_decisions WHERE request_id=?")
            .get(command.id)
        )
          throw new AuthoringError(
            "Review the story decision in Backlog before resolving.",
          );
        if (command.action === "snooze")
          this.attention.snooze(command.id, Date.parse(command.until));
        else
          this.attention.resolve(
            command.id,
            command.source,
            command.answer && this.redactor.text(command.answer),
          );
      } else if (command.action === "search")
        return {
          version: 1,
          kind: "workspace-search",
          query: command.query,
          results: searchEntities(
            this.db,
            this.preferences().productId ?? command.productId,
            command.query,
          ),
        };
      return this.snapshot();
    } catch (e) {
      return {
        version: 1,
        kind: "workspace-error",
        message:
          e instanceof AuthoringError
            ? e.message
            : "The workspace change could not be completed. Refresh and try again.",
      };
    }
  }
}
