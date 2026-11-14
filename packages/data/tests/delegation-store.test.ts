import { afterEach, beforeEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Delegations,
  type DelegationDeps,
} from "../../../apps/desktop/src/delegation.ts";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";

let root: string;
let open: Delegations[];
let delivered: string[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "amun-delegation-store-"));
  open = [];
  delivered = [];
});
afterEach(async () => {
  for (const item of open) item.close();
  await rm(root, { recursive: true, force: true });
});
function make(extra: Partial<DelegationDeps>) {
  const delegations = new Delegations({
    root,
    record: () => ({ ok: true, ref: null }),
    area: () => null,
    harness: () => "pi",
    ready: async () => "ready",
    trust: { has: () => true, grant: () => undefined },
    deliver: async (_harness, id) => void delivered.push(id),
    redact: (text) => text,
    pollMs: 15,
    timeoutMs: 2000,
    ...extra,
  });
  open.push(delegations);
  return delegations;
}
const job = {
  workAreaId: "",
  agent: "qa",
  title: "Check the booking flow",
  task: "Test the booking flow.",
};
const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(done()).toBe(true);
};
const work = async (id: string, text: string) => {
  await writeFile(join(root, id, "result.md"), text, { mode: 0o600 });
  await writeFile(join(root, id, "done"), "", { mode: 0o600 });
};

// A real work store: the draft must be accepted for the work's own group.
function realStore() {
  const db = new Database(":memory:");
  migrate(db);
  const store = new WorkStore(db);
  const send: DelegationDeps["record"] = (command) => {
    const events = store.handle({
      version: 1,
      kind: "work",
      ...command,
    } as never);
    const result = events.find((event) => event.kind === "work-result") as
      { ok: boolean; ref: string | null } | undefined;
    return { ok: !!result?.ok, ref: result?.ref ?? null };
  };
  send({
    action: "finish-setup",
    workTypes: ["product"],
    tools: [],
    agents: [],
    groups: [
      { name: "Employer", routes: [] },
      { name: "Side", routes: [] },
    ],
  });
  const groups = store.snapshot().groups;
  const areaId = send({
    action: "create-area",
    groupId: groups[0]!.id,
    type: "product",
    name: "MoCA",
  }).ref!;
  const lookup: DelegationDeps["area"] = (id) => {
    const found = store.snapshot().areas.find((item) => item.id === id);
    return found
      ? {
          name: found.name,
          type: "Product",
          purpose: "",
          groupId: found.groupId,
        }
      : null;
  };
  return { store, send, groups, areaId, lookup };
}

it("files a grouped area's result as a draft linked to that work", async () => {
  const r = realStore();
  const delegations = make({ record: r.send, area: r.lookup });
  const id = (await delegations.start({ ...job, workAreaId: r.areaId }))!;
  await work(id, "# Checklist\nDouble booking is possible.");
  await until(() => r.store.snapshot().library.length === 1);
  const draft = r.store.snapshot().library[0]!;
  expect(draft.groupId).toBe(r.groups[0]!.id);
  expect(draft.workAreaIds).toEqual([r.areaId]);
  expect(draft.body).toContain("Double booking");
  const savedFlag = async () =>
    JSON.parse(
      (await readFile(join(root, id, "job.json"), "utf8").catch(() => "{}")) ||
        "{}",
    ).saved;
  for (let i = 0; i < 100 && (await savedFlag()) !== true; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await savedFlag()).toBe(true);
});

it("keeps a result whose draft could not be saved and files it after a restart, once", async () => {
  const r = realStore();
  let failing = true;
  const said: string[] = [];
  const record: DelegationDeps["record"] = (command) => {
    if (command.action === "message") said.push(String(command.text));
    return failing && command.action === "save-output"
      ? { ok: false, ref: null }
      : r.send(command);
  };
  const first = make({ record, area: r.lookup });
  const id = (await first.start({ ...job, workAreaId: r.areaId }))!;
  await work(id, "Result that must not be lost.");
  await until(() => said.length > 0);
  expect(r.store.snapshot().library).toEqual([]);
  expect(said.join("\n")).toContain("Result that must not be lost.");
  expect(said.join("\n")).toContain("could not save this as a draft");
  first.close();

  failing = false;
  const second = make({ record, area: r.lookup });
  await second.resume();
  await second.resume();
  expect(r.store.snapshot().library).toHaveLength(1);
  expect(delivered).toHaveLength(1);
});

it("files a result finished before drafts were tracked, once, without resending", async () => {
  const r = realStore();
  const id = "11111111-1111-4111-8111-111111111111";
  await mkdir(join(root, id), { mode: 0o700 });
  await writeFile(join(root, id, "result.md"), "Old finished result.");
  await writeFile(
    join(root, id, "job.json"),
    JSON.stringify({
      id,
      workAreaId: r.areaId,
      agent: "QA",
      title: "Old job",
      harness: "pi",
      activityId: null,
      startedAt: 1,
      state: "done",
    }),
  );
  const delegations = make({ record: r.send, area: r.lookup });
  await delegations.resume();
  await delegations.resume();
  const library = r.store.snapshot().library;
  expect(library).toHaveLength(1);
  expect(library[0]).toMatchObject({ groupId: r.groups[0]!.id });
  expect(delivered).toEqual([]);
});
