import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { adoCredential } from "../packages/connectors-ado/src/keychain.ts";
import { AdoProofClient } from "../packages/connectors-ado/src/client.ts";
import { azureTransport } from "../packages/connectors-ado/src/transport.ts";
// This one-shot proof has explicit user authorization for ICV Test PBI/Test Task only.
// Exclusive receipt prevents accidental reruns. An uncertain create is never retried.
const directory = join(homedir(), "Library/Application Support/Amun/m0");
await mkdir(directory, { recursive: true, mode: 0o700 });
const receipt = join(directory, "icv-write-proof.json");
const journal: Record<string, unknown> = {
  project: "ICV",
  collection: "https://devops.tahaluf.ae/TahalufCollection/",
  startedAt: new Date().toISOString(),
  phase: "not_started",
};
try {
  const pat = await adoCredential().getPassword();
  if (!pat) throw new Error("missing_keychain_credential");
  const marker = await open(receipt, "wx", 0o600);
  await marker.writeFile(JSON.stringify(journal));
  await marker.close();
  const save = async () =>
    writeFile(receipt, JSON.stringify(journal, null, 2) + "\n", {
      mode: 0o600,
    });
  const client = new AdoProofClient(
    String(journal.collection),
    "ICV",
    azureTransport(String(journal.collection), pat),
  );
  journal.phase = "creating_pbi";
  await save();
  const pbi = await client.create("Product Backlog Item", "Test PBI");
  journal.pbi = pbi;
  journal.phase = "pbi_created";
  await save();
  console.log(JSON.stringify({ created: "Test PBI", ...pbi }));
  journal.phase = "creating_task";
  await save();
  const task = await client.create("Task", "Test Task", pbi.id);
  journal.task = task;
  journal.phase = "task_created";
  await save();
  console.log(
    JSON.stringify({ created: "Test Task", ...task, parent: pbi.id }),
  );
  const updated = await client.update(pbi.id, pbi.rev);
  journal.updated = updated;
  journal.phase = "revision_updated";
  await save();
  console.log(JSON.stringify({ updated: updated.id, revision: updated.rev }));
  let staleRejected = false;
  try {
    await client.update(pbi.id, pbi.rev);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    if (!["revision_conflict", "request_rejected_400"].includes(reason))
      throw new Error("stale_result_unverified");
    staleRejected = true;
    journal.staleResponse = reason;
  }
  const current = (await client.item(pbi.id)) as { id?: number; rev?: number };
  if (!staleRejected || current.id !== pbi.id || current.rev !== updated.rev)
    throw new Error("stale_revision_not_proven");
  journal.phase = "complete";
  journal.staleRejected = true;
  journal.revisionUnchanged = true;
  await save();
  console.log(
    JSON.stringify({
      staleRejected: true,
      revisionUnchanged: true,
      pbiId: pbi.id,
      taskId: task.id,
      receipt,
    }),
  );
} catch (error) {
  const reason =
    error instanceof Error &&
    /^(missing_keychain_credential|write_outcome_unknown|revision_conflict|request_rejected_\d+|stale_result_unverified|stale_revision_not_proven)$/.test(
      error.message,
    )
      ? error.message
      : "proof_stopped_check_existing_receipt";
  console.error(
    JSON.stringify({ result: reason, receipt, automaticRetry: false }),
  );
  process.exitCode = 1;
}
