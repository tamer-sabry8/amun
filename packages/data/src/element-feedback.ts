import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { Redactor } from "../../security/src/redaction.ts";
import {
  applyMasks,
  compareCaptures,
  feedbackMessage,
  feedbackPurposes,
  sanitizeCapture,
  type ElementCapture,
  type FeedbackPurpose,
  type Mask,
} from "../../domain/src/element-feedback.ts";

export interface FeedbackRound {
  id: string;
  threadId: string;
  iteration: number;
  intent: string;
  purpose: FeedbackPurpose;
  capture: ReturnType<typeof applyMasks>;
  /** What the agent said it would change, before it changed anything. */
  acknowledgedPlan: string | null;
  after: ElementCapture | null;
  verdict: "accepted" | "iterate" | null;
}

interface Row {
  id: string;
  thread_id: string;
  iteration: number;
  intent: string;
  purpose: FeedbackPurpose;
  capture_json: string;
  acknowledged_plan: string | null;
  after_json: string | null;
  verdict: "accepted" | "iterate" | null;
}

function toRound(row: Row): FeedbackRound {
  return {
    id: row.id,
    threadId: row.thread_id,
    iteration: row.iteration,
    intent: row.intent,
    purpose: row.purpose,
    capture: JSON.parse(row.capture_json) as ReturnType<typeof applyMasks>,
    acknowledgedPlan: row.acknowledged_plan,
    after: row.after_json
      ? (JSON.parse(row.after_json) as ElementCapture)
      : null,
    verdict: row.verdict,
  };
}

/**
 * Rounds of feedback on one element: the masked capture that was shared, the
 * agent's stated plan, the element afterwards and the person's verdict.
 */
export class ElementFeedback {
  private readonly db: Database.Database;
  private readonly redactor: Redactor;
  constructor(db: Database.Database, redactor: Redactor = new Redactor()) {
    this.db = db;
    this.redactor = redactor;
  }

  /**
   * Starts a round. The capture is cleaned, masked and redacted before it is
   * stored, so the stored record is exactly what the agent is given.
   */
  submit(input: {
    capture: unknown;
    intent: string;
    purpose: FeedbackPurpose;
    masks?: readonly Mask[];
    productId?: string;
    /** Continue an earlier thread on the same element. */
    threadId?: string;
  }): { round: FeedbackRound; message: string } {
    if (!feedbackPurposes.includes(input.purpose))
      throw Error("Feedback is a bug report or a design request");
    const capture = this.redactor.clean(
      applyMasks(sanitizeCapture(input.capture), input.masks ?? []),
    ) as ReturnType<typeof applyMasks>;
    const intent = this.redactor.text(input.intent.trim());
    const message = feedbackMessage(capture, intent, input.purpose);
    return this.db
      .transaction(() => {
        const threadId = input.threadId ?? randomUUID();
        const previous = this.thread(threadId).at(-1);
        if (input.threadId && !previous) throw Error("Unknown feedback thread");
        if (previous && previous.verdict !== "iterate")
          throw Error("Review the last change before asking for another");
        const id = randomUUID();
        this.db
          .prepare(
            `INSERT INTO element_feedback(id,product_id,thread_id,iteration,created_at,intent,purpose,capture_json)
             VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            input.productId ?? null,
            threadId,
            (previous?.iteration ?? 0) + 1,
            new Date().toISOString(),
            intent,
            input.purpose,
            JSON.stringify(capture),
          );
        return { round: this.round(id), message };
      })
      .immediate();
  }

  round(id: string): FeedbackRound {
    const row = this.db
      .prepare("SELECT * FROM element_feedback WHERE id=?")
      .get(id) as Row | undefined;
    if (!row) throw Error("Unknown feedback");
    return toRound(row);
  }

  thread(threadId: string): FeedbackRound[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM element_feedback WHERE thread_id=? ORDER BY iteration",
        )
        .all(threadId) as Row[]
    ).map(toRound);
  }

  /** Records the agent's plan. It must name the element it was shown. */
  acknowledge(id: string, plan: string): FeedbackRound {
    const round = this.round(id);
    const text = this.redactor.text(plan.trim());
    if (
      !text.toLowerCase().includes(round.capture.label.toLowerCase()) &&
      !text.includes(round.capture.selector)
    )
      throw Error("The plan must name the selected element");
    this.db
      .prepare("UPDATE element_feedback SET acknowledged_plan=? WHERE id=?")
      .run(text.slice(0, 4000), id);
    return this.round(id);
  }

  /**
   * Records the element after the change and what differs. A change made
   * before the agent stated its plan is refused.
   */
  recordAfter(id: string, after: unknown, masks: readonly Mask[] = []) {
    const round = this.round(id);
    if (!round.acknowledgedPlan)
      throw Error("The agent has not said what it will change");
    const capture = this.redactor.clean(
      applyMasks(sanitizeCapture(after), masks),
    ) as ElementCapture;
    this.db
      .prepare("UPDATE element_feedback SET after_json=? WHERE id=?")
      .run(JSON.stringify(capture), id);
    return compareCaptures(round.capture, capture);
  }

  /** The person accepts the change or asks for another iteration. */
  decide(id: string, verdict: "accepted" | "iterate"): FeedbackRound {
    if (!this.round(id).after) throw Error("There is no change to review yet");
    this.db
      .prepare("UPDATE element_feedback SET verdict=? WHERE id=?")
      .run(verdict, id);
    return this.round(id);
  }
}
