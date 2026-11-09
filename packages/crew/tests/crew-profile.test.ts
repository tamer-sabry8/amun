import { it, expect } from "vitest";
import { crewProfile } from "../src/crew-profile.ts";
import { bearingsSnapshot } from "../../contracts/src/bearings.ts";
it("attributes Firstmate's decisions, next work and history to the selected worker and keeps unverified endpoints unknown", () => {
  const snapshot = bearingsSnapshot.parse({
    schema: "fm-bearings.v1",
    generated: new Date().toISOString(),
    prs: "skipped",
    contributions: { captain: [], known: 0, checked: 0, proven_clear: false },
    secondmates: [{ id: "worker-a", state: "working", doing: "Read policy" }],
    in_flight: [],
    gates: [{ owner: "worker-a", title: "Review tests" }],
    decisions_open: [{ owner: "worker-b", question: "Other context" }],
    landed: [{ owner: "worker-a", what: "First draft" }],
  });
  const p = crewProfile("worker-a", snapshot, { endpoint: "unknown" });
  expect(p).toMatchObject({
    id: "worker-a",
    state: "working",
    current: "Read policy",
    decisions: [],
    next: ["Review tests"],
    history: ["First draft"],
    endpoint: "unknown",
    access: null,
  });
});
