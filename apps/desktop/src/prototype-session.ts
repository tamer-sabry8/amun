import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  prototypeCommand,
  prototypeDesign,
} from "../../../packages/contracts/src/prototype.ts";
import { readBoundedPrivateFile } from "../../../packages/crew/src/endpoint-receipt.ts";
import { ProductDocuments } from "../../../packages/data/src/product-documents.ts";
import { openPrototypePreview } from "./prototype-preview.ts";
export class PrototypeSession {
  private preview:
    | undefined
    | {
        id: string;
        page: Awaited<ReturnType<typeof openPrototypePreview>>;
      };
  constructor(
    private db: Database.Database,
    private root: string,
    private selected: () => string | null,
    private deliver: (id: string, message: string) => Promise<unknown>,
  ) {}
  async close() {
    const old = this.preview;
    this.preview = undefined;
    await old?.page.close();
  }
  async handle(value: unknown) {
    const cmd = prototypeCommand.parse(value),
      meta = {
        kind: "prototype-result",
        product: cmd.product,
        id: cmd.id,
        objective: cmd.objective,
      };
    const docs = new ProductDocuments(this.db),
      current = () =>
        docs.objectives(cmd.product).find((o) => o.id === cmd.objective);
    const objective = current(),
      prd = objective?.prd;
    const active = () =>
      this.selected() === cmd.product &&
      docs.prd(cmd.product, cmd.objective)?.version === cmd.revision;
    if (!active() || !prd?.approved || !objective?.understanding?.approved)
      throw Error("Review the current approved PRD first.");
    const row = this.db
      .prepare(
        "SELECT p.run_id AS id,r.state FROM prototype_runs p JOIN runs r ON r.id=p.run_id WHERE r.product_id=? AND p.objective=? AND p.version=?",
      )
      .get(cmd.product, cmd.objective, cmd.revision) as
      { id: string; state: string } | undefined;
    if (cmd.action === "start") {
      if (row && row.state !== "unknown")
        return {
          ...meta,
          message:
            "A prototype run exists for this PRD version. Open its preview when ready.",
        };
      const id = row?.id ?? randomUUID(),
        dir = join(this.root, "prototypes", id);
      if (!row)
        this.db
          .transaction(() => {
            this.db
              .prepare(
                "INSERT INTO runs(id,product_id,agent_role,harness,state,started_at,firstmate_task_id) VALUES(?,?,'Designer','claude','queued',?,'amun-claude')",
              )
              .run(id, cmd.product, new Date().toISOString());
            this.db
              .prepare(
                "INSERT INTO prototype_runs(run_id,objective,version) VALUES(?,?,?)",
              )
              .run(id, cmd.objective, cmd.revision);
          })
          .immediate();
      try {
        await mkdir(dir, { mode: 0o700, recursive: true });
        if ((await realpath(dir)) !== dir)
          throw Error("Prototype directory changed.");
        const brief = JSON.stringify({
          objective: objective.statement,
          markdown: prd.markdown,
        });
        try {
          await writeFile(join(dir, "brief.json"), brief, {
            flag: "wx",
            mode: 0o600,
          });
        } catch (e) {
          if (
            (e as NodeJS.ErrnoException).code !== "EEXIST" ||
            (await readBoundedPrivateFile(join(dir, "brief.json"), 262144)) !==
              brief
          )
            throw e;
        }
        try {
          await writeFile(join(dir, "design.json"), "", {
            flag: "wx",
            mode: 0o600,
          });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          await readBoundedPrivateFile(join(dir, "design.json"), 64000);
        }
        if (!active()) throw Error("Product changed.");
        await this.deliver(
          id,
          "Designer task. Read " +
            JSON.stringify(join(dir, "brief.json")) +
            ". Return a bounded exploratory prototype. Write ONLY " +
            JSON.stringify(join(dir, "design.json")) +
            " as a private mode 0600 JSON file with title and elements (1 to 16 objects with id, label, description). Use short lowercase dashed element ids. No code execution, repository changes, publishing or external sources.",
        );
        this.db.prepare("UPDATE runs SET state='running' WHERE id=?").run(id);
      } catch {
        this.db.prepare("UPDATE runs SET state='unknown' WHERE id=?").run(id);
        throw Error(
          "Prototype delivery is unconfirmed. Check the existing run.",
        );
      }
      return {
        ...meta,
        message: "Firstmate sent the approved PRD brief to the Designer.",
      };
    }
    if (!row) throw Error("Start a prototype run first.");
    if (cmd.action === "preview") {
      const text = await readBoundedPrivateFile(
        join(this.root, "prototypes", row.id, "design.json"),
        64000,
      );
      const design = prototypeDesign.parse(JSON.parse(text));
      if (!active()) throw Error("Product changed.");
      if (this.preview?.id !== row.id) {
        await this.close();
        this.preview = {
          id: row.id,
          page: await openPrototypePreview(design, active),
        };
      }
      this.db
        .prepare("UPDATE runs SET state='completed' WHERE id=?")
        .run(row.id);
      return {
        ...meta,
        url: this.preview.page.url,
        message: "Prototype ready. Pin feedback on an element in the browser.",
      };
    }
    if (this.preview?.id !== row.id)
      throw Error("Open the prototype before reviewing feedback.");
    const pins = this.preview.page.pins();
    if (!pins.length) throw Error("Pin feedback to a prototype element first.");
    if (objective.proposal)
      throw Error("Review the existing proposal before adding another.");
    const proposal = randomUUID(),
      rationale = "Feedback pinned to " + pins.map((p) => p.element).join(", ");
    this.db
      .prepare(
        "INSERT INTO prd_proposals(id,objective_id,base_version,understanding_version,model,context_json,markdown,rationale,state) VALUES(?,?,?,?,?,?,?,?,'pending')",
      )
      .run(
        proposal,
        cmd.objective,
        cmd.revision,
        objective.understanding.version,
        "pm/prototype-feedback",
        JSON.stringify({ run: row.id, pins }),
        prd.markdown +
          "\n\n## Prototype feedback\n\n" +
          pins.map((p) => "- " + p.element + ": " + p.feedback).join("\n"),
        rationale,
      );
    return {
      ...meta,
      message: "Review the proposed PRD changes.",
      proposal: true,
    };
  }
}
