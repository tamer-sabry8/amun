import { describe, expect, it } from "vitest";
import {
  holdAttention,
  holdId,
  holdSignature,
  settleHoldAnswers,
  type DaemonHold,
  type HoldAnswer,
} from "../src/daemon/contract-adapter.ts";

const hold: DaemonHold = {
  source: "crew",
  taskId: "gitex-prd",
  key: "template",
  verb: "choose",
  summary: "Which PRD template should Product Manager use?",
};
const waiting = (signature: string): HoldAnswer => ({
  signature,
  title: hold.source === "crew" ? hold.summary : "",
  answer: "Lean one-pager",
  at: "2026-11-20T12:00:00Z",
  status: "waiting",
  resend: { sent: "Lean one-pager" },
});

describe("an answer waiting out a dropped connection", () => {
  it("stays waiting, and open, while the same question is still asked", () => {
    const answers = new Map([[holdId(hold), waiting(holdSignature(hold))]]);
    settleHoldAnswers(answers, [hold]);
    expect(answers.get(holdId(hold))?.status).toBe("waiting");
    const [item] = holdAttention(
      { holds: [hold] } as never,
      "2026-11-20T12:01:00Z",
      answers,
    );
    expect(item).toMatchObject({ state: "open" });
    expect(item!.detail).toContain("Waiting to send");
  });
  it("is dropped when the question changed, so the new choices show", () => {
    const answers = new Map([[holdId(hold), waiting("an older question")]]);
    settleHoldAnswers(answers, [hold]);
    expect(answers.has(holdId(hold))).toBe(false);
  });
  it("is never resent once the question was settled elsewhere", () => {
    const answers = new Map([[holdId(hold), waiting(holdSignature(hold))]]);
    settleHoldAnswers(answers, []);
    expect(answers.get(holdId(hold))?.status).toBe("settled");
    const items = holdAttention(
      { holds: [] } as never,
      "2026-11-20T12:01:00Z",
      answers,
    );
    expect(items[0]).toMatchObject({ state: "done" });
    expect(items[0]!.detail).toContain("Already settled");
  });
});
