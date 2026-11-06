import { mkdir, open, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { adoCredential } from "../packages/connectors-ado/src/keychain.ts";
import { AdoProofClient } from "../packages/connectors-ado/src/client.ts";
import { azureTransport } from "../packages/connectors-ado/src/transport.ts";
// Recovery of the definitively rejected Task create documented in T009 evidence.
// No PBI is recreated, and this new single-attempt receipt also refuses reruns.
const directory = join(homedir(), "Library/Application Support/Amun/m0");
const receipt = join(directory, "icv-task-proof.json");
try {
  const prior = JSON.parse(
    await readFile(join(directory, "icv-write-proof.json"), "utf8"),
  ) as { pbi?: { id: number }; phase: string };
  if (prior.pbi?.id !== 1088026 || prior.phase !== "creating_task")
    throw new Error("Unexpected prior receipt");
  const pat = await adoCredential().getPassword();
  if (!pat) throw new Error("No credential");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journal: Record<string, unknown> = {
    pbiId: 1088026,
    reason:
      "Prior task create definitively rejected 400; corrected fields passed validateOnly",
    phase: "creating_task",
  };
  const marker = await open(receipt, "wx", 0o600);
  await marker.writeFile(JSON.stringify(journal));
  await marker.close();
  const save = async () =>
    writeFile(receipt, JSON.stringify(journal, null, 2) + "\n", {
      mode: 0o600,
    });
  const base = "https://devops.tahaluf.ae/TahalufCollection/";
  const client = new AdoProofClient(base, "ICV", azureTransport(base, pat));
  const task = await client.create("Task", "Test Task", 1088026);
  journal.task = task;
  journal.phase = "task_created";
  await save();
  console.log(
    JSON.stringify({ created: "Test Task", ...task, parent: 1088026 }),
  );
  for (const id of [1088026, task.id]) {
    const before = (await client.item(id)) as { rev: number };
    const updated = await client.update(id, before.rev);
    journal[`updated_${id}`] = updated;
    await save();
    console.log(JSON.stringify({ updated: id, revision: updated.rev }));
    let rejected = false;
    try {
      await client.update(id, before.rev);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      if (!["revision_conflict", "request_rejected_400"].includes(reason))
        throw new Error("Unverified stale outcome");
      rejected = true;
    }
    const after = (await client.item(id)) as { id: number; rev: number };
    if (!rejected || after.id !== id || after.rev !== updated.rev)
      throw new Error("Stale revision not proven");
    journal[`stale_${id}`] = { rejected: true, revisionUnchanged: true };
    await save();
    console.log(
      JSON.stringify({ id, staleRejected: true, revisionUnchanged: true }),
    );
  }
  journal.phase = "complete";
  await save();
  console.log(JSON.stringify({ complete: true, receipt }));
} catch (error) {
  console.error(
    JSON.stringify({
      result:
        error instanceof Error &&
        /^(write_outcome_unknown|request_rejected_\d+)$/.test(error.message)
          ? error.message
          : "proof_stopped_check_receipt",
      receipt,
      automaticRetry: false,
    }),
  );
  process.exitCode = 1;
}
