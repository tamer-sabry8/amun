import { AttentionStore } from "./attention-store.ts";
import type Database from "better-sqlite3";
import { understandingRecord } from "../../contracts/src/workspace.ts";
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../../domain/src/governance.ts";
import { pendingProposal, prdRecord } from "../../contracts/src/workspace.ts";
export class AuthoringError extends Error {}

export class ProductDocuments {
  constructor(private db: Database.Database) {}
  objectives(productId: string) {
    const rows = this.db
      .prepare(
        `SELECT o.id,o.statement,a.ask AS question,a.blocking_refs AS refs,
      (SELECT d.chosen FROM decisions d WHERE d.product_id=o.product_id AND json_extract(d.sources_json,'$[0]')=i.request_id ORDER BY d.rowid DESC LIMIT 1) AS answer
      FROM objectives o JOIN product_interviews i ON i.objective_id=o.id JOIN attention_items a ON a.id=i.request_id
      WHERE o.product_id=? ORDER BY o.rowid DESC`,
      )
      .all(productId) as {
      id: string;
      statement: string;
      question: string;
      refs: string;
      answer: string | null;
    }[];
    return rows.map(({ refs, ...row }) => ({
      ...row,
      sourceIds: JSON.parse(refs) as string[],
      links: this.db
        .prepare(
          "SELECT id,version,intent,selection,target FROM prd_selections WHERE objective_id=? ORDER BY rowid",
        )
        .all(row.id) as {
        id: string;
        version: number;
        intent: string;
        selection: string;
        target: string;
      }[],
      understanding: this.understanding(row.id),
      prd: this.prd(productId, row.id),
      proposal: this.proposal(row.id),
    }));
  }
  annotate(
    productId: string,
    objectiveId: string,
    version: number,
    intent: string,
    selection: string,
  ) {
    this.db
      .transaction(() => {
        const prd = this.prd(productId, objectiveId);
        if (prd?.version !== version || !prd.markdown.includes(selection))
          throw new AuthoringError("Select text from the latest saved PRD.");
        const existing = (kind: string) =>
          this.db
            .prepare(
              "SELECT target FROM prd_selections WHERE objective_id=? AND version=? AND intent=? AND selection=?",
            )
            .get(objectiveId, version, kind, selection) as
            { target: string } | undefined;
        if (existing(intent)) return;
        const record = (kind: string, target: string) =>
          this.db
            .prepare(
              "INSERT INTO prd_selections(id,objective_id,version,intent,selection,target) VALUES(?,?,?,?,?,?)",
            )
            .run(randomUUID(), objectiveId, version, kind, selection, target);
        const requirement = existing("link")?.target ?? "REQ-" + randomUUID();
        if (!existing("link")) record("link", requirement);
        if (intent === "link") return;
        const target = randomUUID();
        if (intent === "story")
          this.db
            .prepare(
              "INSERT INTO work_items(id,product_id,type,title,body,requirement_ids,status) VALUES(?,?,'story',?,?,?,'draft')",
            )
            .run(
              target,
              productId,
              selection.slice(0, 256),
              selection,
              JSON.stringify([requirement]),
            );
        if (intent === "source")
          new AttentionStore(this.db).create({
            id: target,
            productId,
            type: "answer",
            origin: { kind: "amun", label: "Amun", firstmateRef: null },
            ask: "Which source supports this requirement?",
            detail: selection,
            blocking: [requirement],
            primaryAction: {
              label: "Provide source",
              mode: "inline",
              intent: "answer",
              targetRef: target,
            },
            governed: false,
            state: "open",
            snoozedUntil: null,
            createdAt: new Date().toISOString(),
          });
        record(intent, target);
      })
      .immediate();
  }
  proposal(objectiveId: string) {
    const row = this.db
      .prepare(
        "SELECT id,markdown,rationale,base_version AS baseVersion FROM prd_proposals WHERE objective_id=? AND state='pending'",
      )
      .get(objectiveId);
    return row ? pendingProposal.parse(row) : null;
  }
  prd(productId: string, objectiveId: string) {
    const row = this.db
      .prepare(
        "SELECT id,version,markdown FROM prds WHERE product_id=? AND objective_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(productId, objectiveId) as
      { id: string; version: number; markdown: string } | undefined;
    if (!row) return null;
    const history = this.db
      .prepare(
        "SELECT version,markdown FROM prd_versions WHERE prd_id=? ORDER BY version DESC",
      )
      .all(row.id);
    const approvals = this.db
      .prepare(
        "SELECT v.version,a.invalidated_reason FROM approvals a JOIN prd_versions v ON v.id=a.prd_version_id WHERE v.prd_id=? AND a.decision='approved' ORDER BY a.rowid DESC",
      )
      .all(row.id) as { version: number; invalidated_reason: string | null }[];
    return prdRecord.parse({
      version: row.version,
      markdown: row.markdown,
      history,
      approved: approvals.some(
        (a) => a.version === row.version && !a.invalidated_reason,
      ),
      invalidated: approvals[0]?.invalidated_reason ?? null,
    });
  }
  changePrd(
    productId: string,
    objectiveId: string,
    expected: number,
    action: string,
    value: string,
  ) {
    this.db
      .transaction(() => {
        const objective = this.objectives(productId).find(
          (o) => o.id === objectiveId,
        );
        if (!objective) throw new AuthoringError("Unknown product objective.");
        const old = objective.prd,
          current = old?.version ?? 0;
        if (current !== expected)
          throw new AuthoringError(
            "PRD changed. Your edit has not been saved. Review the latest version.",
          );
        const prd = this.db
          .prepare(
            "SELECT id FROM prds WHERE objective_id=? AND product_id=? ORDER BY rowid DESC LIMIT 1",
          )
          .get(objectiveId, productId) as { id: string } | undefined;
        const id = prd?.id ?? randomUUID(),
          now = new Date().toISOString();
        if (action === "approve-prd") {
          if (!old || old.markdown !== value)
            throw new AuthoringError(
              "Review the exact saved version before approval.",
            );
          if (old.approved) return;
          const versionId = (
            this.db
              .prepare(
                "SELECT id FROM prd_versions WHERE prd_id=? AND version=?",
              )
              .get(id, current) as { id: string }
          ).id;
          const digest = createHash("sha256")
            .update(
              canonicalJson({
                productId,
                objectiveId,
                version: current,
                markdown: value,
              }),
            )
            .digest("hex");
          this.db
            .prepare(
              "INSERT INTO approvals(id,prd_version_id,decision,kind,payload_hash,target_revisions_json,approved_by,approved_at) VALUES(?,?,'approved','prd',?,?,'pm',?)",
            )
            .run(
              randomUUID(),
              versionId,
              digest,
              JSON.stringify({ prd: current }),
              now,
            );
          return;
        }
        let markdown = value;
        if (action === "apply-proposal" || action === "dismiss-proposal") {
          const proposal = this.db
            .prepare(
              "SELECT markdown,understanding_version FROM prd_proposals WHERE id=? AND objective_id=? AND base_version=? AND state='pending'",
            )
            .get(value, objectiveId, current) as
            { markdown: string; understanding_version: number } | undefined;
          if (!proposal)
            throw new AuthoringError("Proposal is no longer current.");
          if (
            action === "apply-proposal" &&
            (!objective.understanding?.approved ||
              objective.understanding.version !==
                proposal.understanding_version)
          )
            throw new AuthoringError(
              "Review the changed product understanding and regenerate the proposal.",
            );
          this.db
            .prepare("UPDATE prd_proposals SET state=? WHERE id=?")
            .run(action === "apply-proposal" ? "applied" : "dismissed", value);
          if (action === "dismiss-proposal") return;
          markdown = proposal.markdown;
        }
        if (!markdown.trim())
          throw new AuthoringError("Enter PRD content before saving.");
        if (markdown === old?.markdown) return;
        if (prd)
          this.db
            .prepare("UPDATE prds SET markdown=?,version=? WHERE id=?")
            .run(markdown, current + 1, id);
        else
          this.db
            .prepare(
              "INSERT INTO prds(id,product_id,objective_id,version,markdown,created_at) VALUES(?,?,?,1,?,?)",
            )
            .run(id, productId, objectiveId, markdown, now);
        this.db
          .prepare(
            "INSERT INTO prd_versions(id,product_id,objective_id,prd_id,version,markdown,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            productId,
            objectiveId,
            id,
            current + 1,
            markdown,
            now,
          );
        this.db
          .prepare(
            "UPDATE approvals SET invalidated_reason=? WHERE invalidated_reason IS NULL AND prd_version_id IN (SELECT id FROM prd_versions WHERE prd_id=?)",
          )
          .run(
            `Editing v${current} invalidated its approval. Review v${current + 1} before using it for backlog or publication.`,
            id,
          );
        this.db
          .prepare(
            "UPDATE prd_proposals SET state='stale' WHERE objective_id=? AND state='pending'",
          )
          .run(objectiveId);
      })
      .immediate();
  }
  understanding(objectiveId: string) {
    const row = this.db
      .prepare(
        "SELECT version,facts,assumptions,questions,approved FROM product_understandings WHERE objective_id=? ORDER BY version DESC LIMIT 1",
      )
      .get(objectiveId) as { approved: number } | undefined;
    return row
      ? understandingRecord.parse({ ...row, approved: Boolean(row.approved) })
      : null;
  }
  saveUnderstanding(
    productId: string,
    objectiveId: string,
    version: number,
    fields: { facts: string; assumptions: string; questions: string } | null,
  ) {
    this.db
      .transaction(() => {
        const objective = this.objectives(productId).find(
          (row) => row.id === objectiveId,
        );
        if (!objective?.answer)
          throw new AuthoringError(
            "Answer Firstmate’s interview before reviewing the understanding.",
          );
        const current = objective.understanding;
        if ((current?.version ?? 0) !== version)
          throw new AuthoringError(
            "This understanding changed. Review its latest version.",
          );
        if (fields) {
          this.db
            .prepare(
              "INSERT INTO product_understandings(objective_id,version,facts,assumptions,questions,approved) VALUES(?,?,?,?,?,0)",
            )
            .run(
              objectiveId,
              version + 1,
              fields.facts,
              fields.assumptions,
              fields.questions,
            );
        } else {
          if (!current)
            throw new AuthoringError("Save the understanding before approval.");
          this.db
            .prepare(
              "UPDATE product_understandings SET approved=1 WHERE objective_id=? AND version=?",
            )
            .run(objectiveId, version);
        }
      })
      .immediate();
  }
}
