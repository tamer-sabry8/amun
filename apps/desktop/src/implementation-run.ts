import { readBoundedPrivateFile } from "../../../packages/crew/src/endpoint-receipt.ts";
import { AttentionStore } from "../../../packages/data/src/attention-store.ts";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { writeFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import {
  deliveryCommand,
  deliveryScope,
  deliveryResult,
  deliveryReport,
} from "../../../packages/contracts/src/crew.ts";
import {
  previewDeliveryTree,
  materializeDeliveryTree,
  deliveryHead,
} from "../../../packages/crew/src/delivery-worktree.ts";
import { ActionStore } from "../../../packages/data/src/outbox.ts";
import { ProductDocuments } from "../../../packages/data/src/product-documents.ts";
import { bindAction } from "../../../packages/domain/src/governance.ts";
export async function implementationRun(
  input: unknown,
  db: Database.Database,
  root: string,
  current: () => string | null,
  deliver: (
    id: string,
    instruction: string,
  ) => Promise<{ identity: { taskId: string; paneId: string } }>,
  readPull: (
    source: string,
    n: number,
  ) => Promise<{ head: string; sourceBranch: string }>,
) {
  const cmd = deliveryCommand.parse(input);
  const validate = () => {
    if (current() !== cmd.product) throw Error("Product changed.");
  };
  validate();
  const result = (message: string, run?: unknown) =>
    deliveryResult.parse({
      kind: "delivery-result",
      id: cmd.id,
      product: cmd.product,
      story: cmd.story,
      message,
      run,
    });
  const store = new ActionStore(db);
  const latest = db
    .prepare(
      "SELECT id,payload_hash AS binding,state,payload_json AS payload FROM actions WHERE product_id=? AND kind='implementation_scope' AND json_extract(payload_json,'$.story')=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(cmd.product, cmd.story) as
    { id: string; binding: string; state: string; payload: string } | undefined;
  const prior = latest && {
    scope: deliveryScope.parse(JSON.parse(latest.payload).scope),
    binding: latest.binding,
    state: latest.state,
  };
  if (cmd.action === "status")
    return result(
      prior
        ? "Saved implementation scope."
        : "Select a repository and its local checkout.",
      prior,
    );
  const story = db
    .prepare(
      "SELECT w.title,w.body,w.acceptance_json,d.objective_id,d.prd_version FROM work_items w JOIN story_drafts d ON d.item_id=w.id WHERE w.product_id=? AND w.id=? AND w.parent_id IS NULL",
    )
    .get(cmd.product, cmd.story) as
    | {
        title: string;
        body: string;
        acceptance_json: string;
        objective_id: string;
        prd_version: number;
      }
    | undefined;
  if (!story) throw Error("Select a generated story.");
  const approved = new ProductDocuments(db).prd(
    cmd.product,
    story.objective_id,
  );
  if (!approved?.approved || approved.version !== story.prd_version)
    throw Error("Approve the story's current PRD before delegating.");
  const base = join(root, "delivery"),
    brief = {
      title: story.title,
      body: story.body,
      criteria: JSON.parse(story.acceptance_json),
      prdVersion: story.prd_version,
    };
  if (cmd.action === "prepare") {
    if (
      prior &&
      ["approved", "executing", "unknown", "succeeded"].includes(prior.state)
    )
      return result("This story already has a reviewed run.", prior);
    const mapped = db
      .prepare(
        "SELECT external_id AS remote FROM sources WHERE id=? AND kind='repo' AND product_id=?",
      )
      .get(cmd.source, cmd.product) as { remote: string } | undefined;
    if (!mapped) throw Error("Select a mapped repository.");
    const id = randomUUID(),
      scope = await previewDeliveryTree(
        base,
        cmd.checkout,
        mapped.remote,
        id,
        cmd.prefix,
      );
    validate();
    const payload = {
        product: cmd.product,
        story: cmd.story,
        source: cmd.source,
        scope,
      },
      revisions = { brief, head: scope.head };
    store.propose({
      id,
      productId: cmd.product,
      kind: "implementation_scope",
      payload,
      revisions,
      requestedBy: "pm",
      operationMarker: id,
    });
    return result("Review the commit, branch and worktree before starting.", {
      scope,
      binding: bindAction("implementation_scope", payload, revisions),
      state: "pending_approval",
    });
  }
  if (
    !prior ||
    !latest ||
    latest.id !== cmd.run ||
    prior.binding !== cmd.binding
  )
    throw Error("Review the current implementation scope.");
  const action = store.read(cmd.run),
    scope = prior.scope;
  if (
    bindAction("implementation_scope", action.payload, {
      brief,
      head: scope.head,
    }) !== cmd.binding
  )
    throw Error("Story changed. Review the new scope.");
  if (
    !db
      .prepare(
        "SELECT 1 FROM sources WHERE product_id=? AND id=? AND kind='repo' AND external_id=?",
      )
      .get(cmd.product, JSON.parse(latest.payload).source, scope.remote)
  )
    throw Error("Repository mapping changed.");
  if (cmd.action === "refresh") {
    if (prior.state !== "succeeded")
      throw Error("Check the approved run's delivery first.");
    const dir = dirname(scope.worktree),
      report = deliveryReport.parse(
        JSON.parse(
          await readBoundedPrivateFile(join(dir, "report.json"), 8192),
        ),
      );
    if (report.state === "blocked") {
      const request = createHash("sha256")
          .update(cmd.run + " " + report.question)
          .digest("hex"),
        attention = new AttentionStore(db);
      const existing = db
        .prepare(
          "SELECT state FROM attention_items WHERE id=? AND product_id=?",
        )
        .get(request, cmd.product) as { state: string } | undefined;
      if (!existing) {
        db.transaction(() => {
          attention.create({
            id: request,
            productId: cmd.product,
            type: "answer",
            origin: {
              kind: "crewmate",
              label: "Engineer",
              firstmateRef: cmd.run,
            },
            ask: report.question,
            detail: "Answer to resume the implementation run.",
            blocking: [cmd.run, cmd.story],
            primaryAction: {
              label: "Answer",
              mode: "inline",
              intent: "answer",
              targetRef: request,
            },
            governed: false,
            state: "open",
            snoozedUntil: null,
            createdAt: new Date().toISOString(),
          });
          db.prepare("UPDATE runs SET state='blocked' WHERE id=?").run(cmd.run);
        }).immediate();
      }
      if (existing?.state !== "resolved")
        return result(
          "The Engineer needs a decision. Open Requests to answer.",
          prior,
        );
      const decision = db
        .prepare(
          "SELECT id,chosen FROM decisions WHERE product_id=? AND decided_by='pm' AND json_extract(sources_json,'$[0]')=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(cmd.product, request) as
        { id: string; chosen: string } | undefined;
      if (!decision) throw Error("Review the blocker decision.");
      const answerFile = join(dir, "decision-" + decision.id + ".json");
      try {
        await writeFile(
          answerFile,
          JSON.stringify({
            question: report.question,
            answer: decision.chosen,
          }),
          { flag: "wx", mode: 0o600 },
        );
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await readBoundedPrivateFile(answerFile, 32768)) !==
            JSON.stringify({
              question: report.question,
              answer: decision.chosen,
            })
        )
          throw e;
      }
      validate();
      await deliver(
        decision.id,
        "Resume the same approved worktree with the decision in " +
          JSON.stringify(answerFile) +
          ".",
      );
      db.prepare("UPDATE runs SET state='running' WHERE id=?").run(cmd.run);
      return result(
        "The reviewed decision was delivered. The Engineer resumed.",
        prior,
      );
    }
    const remote = await readPull(
      JSON.parse(latest.payload).source,
      report.number,
    );
    validate();
    if (
      remote.head !== report.head ||
      remote.sourceBranch !== scope.branch ||
      (await deliveryHead(base, scope)) !== report.head
    )
      throw Error("Review the changed PR or checkout head.");
    db.transaction(() => {
      db.prepare(
        "INSERT INTO delivery_pull_requests(run_id,repo,number,head) VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET head=excluded.head WHERE repo=excluded.repo AND number=excluded.number",
      ).run(cmd.run, scope.remote, report.number, report.head);
      const saved = db
        .prepare("SELECT number FROM delivery_pull_requests WHERE run_id=?")
        .get(cmd.run) as { number: number };
      if (saved.number !== report.number)
        throw Error("Review the changed PR number.");
      db.prepare("UPDATE runs SET state='completed' WHERE id=?").run(cmd.run);
      db.prepare(
        "INSERT OR REPLACE INTO artifacts(id,product_id,kind,path_or_uri,run_id) VALUES(?,?,'test evidence',?,?)",
      ).run(cmd.run + "-tests", cmd.product, join(dir, "report.json"), cmd.run);
    }).immediate();
    return result(
      "Verified PR #" + report.number + " · " + report.tests,
      prior,
    );
  }
  if (prior.state === "succeeded")
    return result("Firstmate already received this run.", prior);
  if (prior.state === "pending_approval") store.approve(cmd.run, "pm");
  if (
    prior.state !== "unknown" &&
    !store.claim("implementation_scope", cmd.run)
  )
    throw Error("Check this run before retrying delivery.");
  try {
    const worktree = await materializeDeliveryTree(base, scope);
    validate();
    const file = join(dirname(worktree), "brief.json");
    const contents = JSON.stringify(
      {
        ...brief,
        worktree,
        branch: scope.branch,
        report: join(dirname(worktree), "report.json"),
        reportFormat:
          "Write private mode 0600 JSON: {state:blocked,question} or {state:pull_request,number,head,tests}.",
      },
      null,
      2,
    );
    try {
      await writeFile(file, contents, { mode: 0o600, flag: "wx" });
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code !== "EEXIST" ||
        (await readBoundedPrivateFile(file, 65536)) !== contents
      )
        throw e;
    }
    db.prepare(
      "INSERT INTO runs(id,product_id,story_id,agent_role,harness,worktree,branch,state,started_at) VALUES(?,?,?,'Engineer','codex',?,?,'queued',?) ON CONFLICT(id) DO NOTHING",
    ).run(
      cmd.run,
      cmd.product,
      cmd.story,
      worktree,
      scope.branch,
      new Date().toISOString(),
    );
    const receipt = await deliver(
      cmd.run,
      "Read the approved implementation brief at " +
        JSON.stringify(file) +
        ". Work only in the named worktree and branch. Report blockers and test results to Firstmate. Remote writes require the configured restricted worker identity. Do not merge or force push.",
    );
    db.transaction(() => {
      db.prepare(
        "UPDATE runs SET state='running',firstmate_task_id=?,pane_ref=?,backend='tmux' WHERE id=?",
      ).run(receipt.identity.taskId, receipt.identity.paneId, cmd.run);
      store.finish(cmd.run, "succeeded");
    }).immediate();
    return result("Firstmate delivered the brief to the Engineer.", {
      ...prior,
      state: "succeeded",
    });
  } catch {
    if (store.read(cmd.run).state === "executing")
      store.finish(cmd.run, "unknown");
    db.prepare("UPDATE runs SET state='unknown' WHERE id=?").run(cmd.run);
    throw Error("Check the saved run. Delivery outcome is unconfirmed.");
  }
}
