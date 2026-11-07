import { expect, it } from "vitest";
import { boardPayload } from "../src/firstmate-board.ts";
import { Redactor } from "../../security/src/redaction.ts";
it("renders a nonempty fleet without exposing unselected row fields or offering actions for integrity notices", () => {
  const redactor = new Redactor();
  redactor.register("BOARD_CANARY");
  const board = boardPayload(
    "/crew",
    {
      schema: "fm-bearings.v1",
      generated: "2026-11-07T08:00:00.000Z",
      prs: "skipped",
      contributions: { captain: [], known: 0, checked: 0, proven_clear: true },
      decisions_open: [],
      landed: [
        {
          id: "done",
          owner: "main",
          what: "Completed BOARD_CANARY",
          extra: "PRIVATE_FIELD",
        },
      ],
      in_flight: [],
      secondmates: [
        { id: "codex", state: "working", summary: "Running tests" },
      ],
      gates: [
        {
          id: "(main-inventory)",
          title: "Repair",
          reason: "missing",
          filed: "-",
        },
      ],
    },
    redactor,
  );
  expect(JSON.stringify(board)).not.toMatch(/BOARD_CANARY|PRIVATE_FIELD/);
  expect(board.underway[0]?.name).toBe("codex");
  expect(board.charted[0]).toMatchObject({
    kind: "warning",
    dispatchable: false,
  });
});
