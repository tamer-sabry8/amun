import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { AttentionStore } from "./attention-store.ts";
import { AuthoringError } from "./product-documents.ts";
import {
  decisionOptions,
  type StoryDecision,
} from "../../contracts/src/workspace.ts";

export class StoryDecisions {
  constructor(private db: Database.Database) {}
  target(productId: string, itemId: string) {
    const row = this.db
      .prepare(
        "SELECT w.id,w.title,w.body,d.requirement_id AS requirementId,d.requirement_text AS requirement FROM work_items w JOIN story_drafts d ON d.item_id=w.id WHERE w.product_id=? AND w.id=?",
      )
      .get(productId, itemId) as
      | {
          id: string;
          title: string;
          body: string;
          requirement: string;
          requirementId: string;
        }
      | undefined;
    if (!row) throw new AuthoringError("Select a draft in this product.");
    return row;
  }
  list(productId: string): StoryDecision[] {
    return this.db
      .prepare(
        `SELECT a.id,a.ask AS question,a.created_at AS createdAt,a.state,d.item_id AS itemId,d.requirement_id AS requirementId,d.options_json,d.proposed,d.missing,d.choice,d.confirmation,d.requested FROM story_decisions d JOIN attention_items a ON a.id=d.request_id WHERE a.product_id=? ORDER BY a.rowid`,
      )
      .all(productId)
      .map((raw) => {
        const { options_json, requested, ...row } = raw as Omit<
          StoryDecision,
          "options" | "requested"
        > & { options_json: string; requested: number };
        return {
          ...row,
          options: JSON.parse(options_json),
          requested: !!requested,
        };
      });
  }
  open(productId: string, itemId: string, input: unknown) {
    const d = decisionOptions.parse(input);
    const target = this.target(productId, itemId);
    if (!d.options.includes(d.proposed))
      throw new AuthoringError(
        "The proposal must be one of the listed options.",
      );
    if (
      this.list(productId).some(
        (x) => x.itemId === itemId && x.state !== "resolved",
      )
    )
      return;
    this.db
      .transaction(() => {
        const id = randomUUID();
        new AttentionStore(this.db).create({
          id,
          productId,
          type: "decide",
          origin: { kind: "firstmate", label: "Firstmate", firstmateRef: null },
          ask: d.question,
          detail: d.missing,
          blocking: [itemId, target.requirementId],
          primaryAction: {
            label: "Review story decision",
            mode: "navigate",
            intent: "open_request",
            targetRef: id,
          },
          governed: false,
          state: "open",
          snoozedUntil: null,
          createdAt: new Date().toISOString(),
        });
        this.db
          .prepare(
            "INSERT INTO story_decisions(request_id,item_id,requirement_id,options_json,proposed,missing) VALUES(?,?,?,?,?,?)",
          )
          .run(
            id,
            itemId,
            target.requirementId,
            JSON.stringify(d.options),
            d.proposed,
            d.missing,
          );
      })
      .immediate();
  }
  review(
    productId: string,
    id: string,
    operation: "save" | "request" | "later" | "resolve",
    choice: string,
    confirmation: string,
  ) {
    this.db
      .transaction(() => {
        const d = this.list(productId).find((x) => x.id === id);
        if (!d || d.state === "resolved")
          throw new AuthoringError(
            "This story decision is closed or unavailable.",
          );
        if (operation === "later") {
          new AttentionStore(this.db).snooze(id, Date.now() + 86400000);
          return;
        }
        if (!d.options.includes(choice))
          throw new AuthoringError("Select one of the decision options.");
        if (operation === "resolve" && d.missing && !confirmation.trim())
          throw new AuthoringError(
            "Record the missing confirmation before resolving.",
          );
        this.db
          .prepare(
            "UPDATE story_decisions SET choice=?,confirmation=?,requested=CASE WHEN ?='request' THEN 1 ELSE requested END WHERE request_id=?",
          )
          .run(choice, confirmation, operation, id);
        if (operation === "request")
          this.db
            .prepare(
              "UPDATE attention_items SET state='open',snoozed_until=NULL,detail=? WHERE id=?",
            )
            .run("Confirmation requested: " + d.missing, id);
        if (operation !== "resolve") return;
        this.db
          .prepare(
            "UPDATE attention_items SET state='resolved',resolved_at=?,resolved_by='pm',snoozed_until=NULL WHERE id=?",
          )
          .run(new Date().toISOString(), id);
        this.db
          .prepare(
            "UPDATE work_items SET body=coalesce(body,'') || ? WHERE id=? AND product_id=?",
          )
          .run("\n" + d.question + " " + choice, d.itemId, productId);
        this.db
          .prepare(
            "INSERT INTO decisions(id,product_id,question,chosen,rationale,sources_json,decided_by,decided_at,options_json) VALUES(?,?,?,?,?,?,'pm',?,?)",
          )
          .run(
            randomUUID(),
            productId,
            d.question,
            choice,
            confirmation,
            JSON.stringify([id, d.requirementId, d.itemId]),
            new Date().toISOString(),
            JSON.stringify(d.options),
          );
      })
      .immediate();
  }
}
