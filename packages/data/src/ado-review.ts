import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AdoBatch, type AdoDestination, type AdoStep } from "./ado-batch.ts";
import type {
  AzureProcessSchema,
  AdoOperation,
} from "../../contracts/src/backlog.ts";
import { requiredInputs } from "../../connectors-ado/src/publication-fields.ts";
import type { AdoWriteClient } from "../../connectors-ado/src/governed-writes.ts";
import { ProductDocuments } from "./product-documents.ts";
type Preview = Extract<AdoOperation, { action: "preview" }>;
interface Draft {
  id: string;
  parent_id: string | null;
  type: string;
  title: string;
  body: string;
  acceptance_json: string;
  remote_id: string | null;
  objective_id: string;
  prd_version: number;
  requirement_id: string;
}
export class AdoReview {
  constructor(private db: Database.Database) {}
  private draft(product: string, id: string) {
    const row = this.db
      .prepare(
        `SELECT w.*,d.objective_id,d.prd_version,d.requirement_id FROM work_items w JOIN story_drafts d ON d.item_id=w.id WHERE w.id=? AND w.product_id=?`,
      )
      .get(id, product) as Draft | undefined;
    if (!row) throw Error("Draft is unavailable in this product.");
    const prd = new ProductDocuments(this.db).prd(product, row.objective_id);
    if (!prd?.approved || prd.version !== row.prd_version)
      throw Error("Approve the source PRD version before publication.");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM story_decisions d JOIN attention_items a ON a.id=d.request_id WHERE (d.item_id=? OR d.requirement_id=?) AND a.state<>'resolved'",
        )
        .get(id, row.requirement_id)
    )
      throw Error("Resolve the linked story decision first.");
    return row;
  }
  async prepare(
    cmd: Preview,
    destination: AdoDestination,
    schema: AzureProcessSchema,
    iterations: string[],
    client: AdoWriteClient,
  ) {
    const steps: AdoStep[] = [];
    if (!schema.areas.includes(cmd.area))
      throw Error("Select a discovered area path.");
    if (cmd.intent === "commit" && !iterations.includes(cmd.iteration))
      throw Error("Select a team iteration.");
    for (const input of cmd.items) {
      const row = this.draft(cmd.productId, input.id);
      const marker = "Test-" + randomUUID();
      if (cmd.intent === "publish") {
        if (row.remote_id) throw Error("Item is already published.");
        if (cmd.iteration !== destination.project || cmd.assignee)
          throw Error(
            "Publish to the project root. Plan the sprint separately.",
          );
        const type = schema.types.find((t) => t.name === input.type);
        if (!type) throw Error("Select a discovered work item type.");
        const fields: AdoStep["fields"] = { ...input.fields };
        for (const [key, v] of Object.entries(fields)) {
          const definition = type.fields.find((f) => f.referenceName === key);
          if (
            !definition ||
            key.startsWith("System.") ||
            (definition.allowedValues.length &&
              !definition.allowedValues.includes(String(v)))
          )
            throw Error("Review the supplied work item fields.");
        }
        Object.assign(fields, {
          "System.Title": input.title,
          "System.AreaPath": cmd.area,
          "System.IterationPath": destination.project,
        });
        const escape = (v: string) =>
          v
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
        if (type.fields.some((f) => f.referenceName === "System.Description"))
          fields["System.Description"] = "<p>" + escape(row.body) + "</p>";
        const criteria = JSON.parse(row.acceptance_json) as string[];
        if (
          criteria.length &&
          type.fields.some(
            (f) =>
              f.referenceName === "Microsoft.VSTS.Common.AcceptanceCriteria",
          )
        )
          fields["Microsoft.VSTS.Common.AcceptanceCriteria"] =
            "<ul>" +
            criteria.map((c) => "<li>" + escape(c) + "</li>").join("") +
            "</ul>";
        const missing = requiredInputs(type, fields);
        if (missing.length)
          throw Error("Required fields: " + missing.join(", "));
        steps.push({
          itemId: row.id,
          parentId: row.parent_id,
          remoteId: null,
          revision: 0,
          marker,
          type: type.name,
          fields,
        });
      } else {
        if (!row.remote_id)
          throw Error("Publish selected items before sprint planning.");
        const prior = this.db
          .prepare(
            "SELECT b.destination_json AS json FROM ado_steps s JOIN ado_batches b ON b.id=s.batch_id JOIN actions a ON a.id=s.action_id WHERE b.product_id=? AND b.kind='publish' AND s.item_id=? AND s.remote_id=? AND a.state='succeeded'",
          )
          .get(cmd.productId, row.id, Number(row.remote_id)) as
          { json: string } | undefined;
        if (!prior) throw Error("Missing publication receipt.");
        const target = JSON.parse(prior.json) as AdoDestination;
        if (
          target.collection !== destination.collection ||
          target.project !== destination.project ||
          target.team !== destination.team
        )
          throw Error("Published destination changed.");
        const current = await client.item(Number(row.remote_id));
        const fields: AdoStep["fields"] = {
          "System.IterationPath": cmd.iteration,
        };
        if (cmd.assignee.trim())
          fields["System.AssignedTo"] = cmd.assignee.trim();
        steps.push({
          itemId: row.id,
          parentId: null,
          remoteId: current.id,
          revision: current.rev,
          marker,
          type: String(current.fields["System.WorkItemType"]),
          fields,
        });
      }
    }
    return new AdoBatch(this.db).prepare(
      cmd.productId,
      cmd.intent,
      destination,
      steps,
    );
  }
  validate(
    product: string,
    destination: AdoDestination,
    id: string,
    binding: string,
  ) {
    const p = new AdoBatch(this.db).preview(id);
    if (
      p.binding !== binding ||
      p.productId !== product ||
      p.destination.collection !== destination.collection ||
      p.destination.project !== destination.project ||
      p.destination.team !== destination.team
    )
      throw Error("Preview destination or contents changed.");
    for (const s of p.steps) this.draft(product, s.itemId);
    return p;
  }
}
