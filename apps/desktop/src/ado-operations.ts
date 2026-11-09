import type Database from "better-sqlite3";
import type { AdoOperation } from "../../../packages/contracts/src/backlog.ts";
import {
  AdoBatch,
  type AdoDestination,
} from "../../../packages/data/src/ado-batch.ts";
import { AdoReview } from "../../../packages/data/src/ado-review.ts";
import type { BoardDiscovery } from "../../../packages/connectors-ado/src/board-discovery.ts";
import type { AdoWriteClient } from "../../../packages/connectors-ado/src/governed-writes.ts";
import { editBoardCard } from "../../../packages/connectors-ado/src/card-edit.ts";
export async function runAdoOperation(
  db: Database.Database,
  request: AdoOperation,
  target: AdoDestination,
  reader: BoardDiscovery,
  client: AdoWriteClient,
  current: () => boolean,
) {
  const meta = {
    kind: "ado-operation-result",
    productId: request.productId,
    requestId: request.requestId,
  };
  const check = () => {
    if (!current()) throw Error("Product selection changed.");
  };
  const batches = new AdoBatch(db),
    review = new AdoReview(db);
  const projects = await reader.teams();
  if (!projects.some((t) => t.id === target.team))
    throw Error("Select a discovered team.");
  if (request.action === "targets") {
    const recent = db
      .prepare(
        "SELECT id FROM ado_batches WHERE product_id=? AND json_extract(destination_json,'$.collection')=? AND json_extract(destination_json,'$.project')=? AND json_extract(destination_json,'$.team')=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(
        request.productId,
        target.collection,
        target.project,
        target.team,
      ) as { id: string } | undefined;
    const p = recent ? batches.preview(recent.id) : null;
    return {
      ...meta,
      message: "Sprint iterations loaded.",
      iterations: await reader.iterations(target.team),
      ...(p
        ? {
            batchId: p.id,
            binding: p.binding,
            preview: JSON.stringify(
              { intent: p.kind, destination: p.destination, steps: p.steps },
              null,
              2,
            ),
            receipts: p.entries,
          }
        : {}),
    };
  }
  if (request.action === "edit") {
    const level = (await reader.levels(target.team)).find(
      (l) => l.id === request.level,
    );
    if (!level) throw Error("Unknown backlog level");
    const settings = await reader.boardSettings(target.team, level.name);
    const card = (
      await reader.cards(target.team, level.id, settings.columnField)
    ).find((c) => c.id === request.itemId);
    if (!card || card.rev !== request.revision)
      throw Error("revision_conflict");
    const columns = await reader.columns(target.team, level.name, true);
    check();
    const result = await editBoardCard(
      {
        id: card.id,
        rev: card.rev,
        type: card.type,
        title: request.title,
        column: request.column,
        columnField: settings.columnField,
        columns,
      },
      client,
    );
    return {
      ...meta,
      message:
        "Saved and verified #" + result.id + " at revision " + result.rev + ".",
    };
  }
  if (request.action === "preview") {
    const [schema, iterations] = await Promise.all([
      reader.processSchema(),
      request.intent === "commit"
        ? reader.iterations(target.team)
        : Promise.resolve([]),
    ]);
    check();
    const p = await review.prepare(request, target, schema, iterations, client);
    return {
      ...meta,
      message: "Review the exact destination and fields.",
      batchId: p.id,
      binding: p.binding,
      preview: JSON.stringify(
        { intent: p.kind, destination: p.destination, steps: p.steps },
        null,
        2,
      ),
      receipts: p.entries,
    };
  }
  check();
  const p = review.validate(
    request.productId,
    target,
    request.batchId,
    request.binding,
  );
  if (request.action === "approve-execute") batches.approve(p.id, p.binding);
  const receipts = await batches.execute(p.id, p.binding, client);
  return {
    ...meta,
    batchId: p.id,
    binding: p.binding,
    receipts,
    message: receipts.every((r) => r.state === "succeeded")
      ? "Verified all " + receipts.length + " Azure items."
      : "Execution paused. Reconcile the outstanding item before continuing.",
  };
}
