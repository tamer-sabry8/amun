import type { BoardDiscovery } from "./ado-board-discovery.ts";
import { prdComparison } from "../../contracts/src/workspace.ts";
import { appendAzureCriteria } from "./ado-publication-fields.ts";
import { createHash, randomUUID } from "node:crypto";
import type { Database } from "./sqlite.ts";
import { AdoBatch, type AdoDestination, type AdoStep } from "./ado-batch.ts";
import type {
  AzureProcessSchema,
  AdoOperation,
} from "../../contracts/src/backlog.ts";
import { storyTextFields, requiredInputs } from "./ado-publication-fields.ts";
import type { AdoWriteClient } from "./ado-governed-writes.ts";
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
function draftDigest(row: Draft) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.id,
        row.parent_id,
        row.type,
        row.title,
        row.body,
        row.acceptance_json,
        row.remote_id,
        row.objective_id,
        row.prd_version,
        row.requirement_id,
      ]),
    )
    .digest("hex");
}

export class AdoReview {
  constructor(private db: Database) {}
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
    reader: BoardDiscovery,
  ) {
    const steps: AdoStep[] = [];
    if (!schema.areas.includes(cmd.area))
      throw Error("Select a discovered area path.");
    if (cmd.intent === "commit" && !iterations.includes(cmd.iteration))
      throw Error("Select a team iteration.");
    let backlog: Awaited<ReturnType<BoardDiscovery["cards"]>> = [];
    if (cmd.intent === "publish") {
      const level = (await reader.levels(cmd.team, true)).find(
        (l) => l.id === cmd.level,
      );
      if (!level)
        throw Error(
          "Select the team backlog and compare the PRD before publication.",
        );
      const settings = await reader.boardSettings(cmd.team, level.name);
      backlog = await reader.cards(cmd.team, level.id, settings.columnField);
    }
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
        const stored = this.db
          .prepare(
            "SELECT result_json FROM prd_comparisons WHERE product_id=? AND objective_id=? AND version=? AND source_id=? AND team=? AND level=?",
          )
          .get(
            cmd.productId,
            row.objective_id,
            row.prd_version,
            cmd.sourceId,
            cmd.team,
            cmd.level ?? "",
          ) as { result_json: string } | undefined;
        const proposal =
          stored &&
          prdComparison
            .parse(JSON.parse(stored.result_json))
            .rows.find((r) => r.draftId === (row.parent_id ?? row.id));
        if (!proposal || proposal.classification === "held")
          throw Error(
            "Complete the backlog comparison and resolve this held proposal first.",
          );
        const duplicate = backlog.some(
          (c) =>
            c.title.trim().toLowerCase() === input.title.trim().toLowerCase(),
        );
        if (
          (duplicate || (!row.parent_id && proposal.providerId)) &&
          !input.duplicateDecision
        )
          throw Error(
            "An existing story may cover this requirement. Choose the existing ID or explicitly create separately.",
          );
        if (input.duplicateDecision === "edit-existing") {
          const record = backlog.find((c) => c.id === input.targetId);
          if (!record || row.parent_id)
            throw Error("Select a verified existing story from this backlog.");
          if (
            proposal.providerId === record.id &&
            proposal.revision !== record.rev
          )
            throw Error("The comparison is stale. Refresh the existing story.");
          const existing = await client.item(record.id);
          if (
            existing.rev !== record.rev ||
            existing.fields["System.WorkItemType"] !== type.name
          )
            throw Error("Existing story revision or type changed.");
          const key = type.fields.some(
            (f) =>
              f.referenceName === "Microsoft.VSTS.Common.AcceptanceCriteria",
          )
            ? "Microsoft.VSTS.Common.AcceptanceCriteria"
            : "System.Description";
          if (!type.fields.some((f) => f.referenceName === key))
            throw Error(
              "This type has no writable acceptance criteria destination.",
            );
          const before = existing.fields[key] ?? "";
          if (typeof before !== "string")
            throw Error("Review the current criteria field.");
          const after = appendAzureCriteria(
            before,
            JSON.parse(row.acceptance_json),
            key === "System.Description",
          );
          const edits: AdoStep["fields"] = {};
          if (after !== before) edits[key] = after;
          if (
            input.title !== row.title &&
            input.title !== existing.fields["System.Title"]
          )
            edits["System.Title"] = input.title;
          if (Object.keys(input.fields).length)
            throw Error("Review existing-story field edits separately.");
          if (!Object.keys(edits).length)
            throw Error(
              "The existing story already contains the reviewed values.",
            );
          steps.push({
            itemId: row.id,
            draftDigest: draftDigest(row),
            type: type.name,
            parentId: null,
            remoteId: record.id,
            revision: record.rev,
            marker,
            fields: edits,
          });
          continue;
        }
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
        Object.assign(
          fields,
          storyTextFields(
            type.fields,
            row.body,
            JSON.parse(row.acceptance_json),
          ),
        );
        const missing = requiredInputs(type, fields);
        if (missing.length)
          throw Error("Required fields: " + missing.join(", "));
        steps.push({
          itemId: row.id,
          draftDigest: draftDigest(row),
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
          draftDigest: draftDigest(row),
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
  validateDrafts(product: string, steps: AdoStep[]) {
    for (const step of steps) {
      if (step.draftDigest !== draftDigest(this.draft(product, step.itemId)))
        throw Error(
          "The draft changed after preview. Review its current wording before submitting.",
        );
    }
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
    return p;
  }
}
