// Dev-only live acceptance for the Linear and Jira plan targets (not shipped).
// It uses a separate Keychain service (ai.amun.dev-acceptance), an in-memory
// work store, and the captain's own approval step (approve-plan with the
// plan's fingerprint) before anything is published. Sign in first with
// scripts/dev-tracker-harness.ts <root> connect <linear|jira>.
//   node --experimental-transform-types scripts/dev-tracker-acceptance.ts <root> <linear|jira> '<plan items json>'
import { AsyncEntry } from "@napi-rs/keyring";
import { TrackerHost, type TrackerId } from "../packages/notion/src/tracker-host.ts";
import { openDatabase } from "../packages/work-store/src/sqlite.ts";
import { migrate } from "../packages/work-store/src/database.ts";
import { WorkStore } from "../packages/work-store/src/work-store.ts";
import { PlanPublisher } from "../packages/work-store/src/plan-publication.ts";
import { trackerResolver } from "../packages/work-store/src/trackers/tracker-target.ts";

const [root, provider, itemsJson] = process.argv.slice(2) as [string, TrackerId, string];
const service = "ai.amun.dev-acceptance";
const host = new TrackerHost({
  workspace: "dev-acceptance",
  root,
  registerSecret: () => {},
  secrets: {
    get: async (a) => (await new AsyncEntry(service, a).getPassword()) ?? undefined,
    set: async (a, s) => void (await new AsyncEntry(service, a).setPassword(s)),
    delete: async (a) => void (await new AsyncEntry(service, a).deleteCredential()),
  },
});
const db = openDatabase(":memory:");
migrate(db);
const store = new WorkStore(db);
const send = (action: string, extra: Record<string, unknown>) =>
  store.handle({ version: 1, kind: "work", action, ...extra }).find((e) => e.kind === "work-result") as { ok: boolean; ref: string; message: string };
const proposed = send("propose-plan", { groupId: null, workAreaId: null, planKind: "stories", destination: provider, summary: "Amun live acceptance", items: JSON.parse(itemsJson) });
if (!proposed.ok) throw Error(proposed.message);
const plan = () => store.snapshot().plans.find((p) => p.id === proposed.ref)!;
const approval = send("approve-plan", { planId: proposed.ref, fingerprint: plan().fingerprint });
if (!approval.ok) throw Error(approval.message);
const publisher = new PlanPublisher(db, store, trackerResolver(db, {
  configured: async (p) => (await host.status(p)).status !== "missing",
  // AMUN_DEV_LOSE=<tool>: the first call of that tool runs, but its answer
  // is lost, so the publisher must find the item by marker, not resend it.
  use: (p, work) =>
    host.use(p, (session) =>
      work({
        tools: session.tools,
        call: async (name, args) => {
          const result = await session.call(name, args);
          if (name === process.env.AMUN_DEV_LOSE || (name.startsWith("execute") && args.name === process.env.AMUN_DEV_LOSE && (args.inputs as { action?: string })?.action === "create")) {
            delete process.env.AMUN_DEV_LOSE;
            throw Error("socket hang up (simulated after the write)");
          }
          return result;
        },
      }),
    ),
}));
await publisher.publish(proposed.ref);
console.log(JSON.stringify({ state: plan().state, results: plan().results, writes: publisher.writes(proposed.ref) }, null, 1));
