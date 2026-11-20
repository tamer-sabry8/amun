import { describe, expect, it } from "vitest";
import {
  rfpAttention,
  rfpColumn,
  rfpColumnDrop,
  rfpMoney,
  rfpPeople,
  rfpStats,
  type Rfp,
} from "../src/work/flows.ts";
import { portfolioCard, portfolioOrder } from "../src/work/portfolio.ts";

const now = Date.parse("2026-11-20T10:00:00Z");
const day = (offset: number) =>
  new Date(now + offset * 86_400_000).toISOString();
const rfp = (id: string, extra: Partial<Rfp> = {}): Rfp => ({
  id,
  client: "Client",
  stage: "received",
  deadline: null,
  responseOwner: null,
  accountOwner: null,
  presales: null,
  proposalSigned: false,
  brdApproved: false,
  deliveryProjectId: null,
  lossReason: null,
  ...extra,
});

describe("the five RFP columns", () => {
  it("reads each stage, and a hold on an open RFP, as a column", () => {
    expect(rfpColumn(rfp("a"))).toBe("new");
    expect(rfpColumn(rfp("a", { stage: "in_response" }))).toBe("in_progress");
    expect(rfpColumn(rfp("a", { stage: "submitted" }))).toBe("in_progress");
    expect(rfpColumn(rfp("a", { stage: "in_response", heldAt: day(-9) }))).toBe(
      "on_hold",
    );
    expect(rfpColumn(rfp("a", { stage: "handed_to_delivery" }))).toBe("won");
    expect(rfpColumn(rfp("a", { stage: "withdrawn" }))).toBe("lost");
    // A hold left on a decided RFP does not pull it back.
    expect(rfpColumn(rfp("a", { stage: "won", heldAt: day(-1) }))).toBe("won");
  });
  it("says what a drop on a column does", () => {
    const open = rfp("a", { stage: "in_response" });
    expect(rfpColumnDrop(open, "in_progress")).toEqual({ do: "none" });
    expect(rfpColumnDrop(open, "on_hold")).toEqual({ do: "hold" });
    expect(rfpColumnDrop(open, "won")).toEqual({ do: "move", stage: "won" });
    expect(rfpColumnDrop(rfp("a", { stage: "won" }), "on_hold")).toEqual({
      do: "none",
    });
    // Off hold, a submitted RFP goes back to submitted.
    expect(
      rfpColumnDrop(
        rfp("a", { stage: "submitted", heldAt: day(-2) }),
        "in_progress",
      ),
    ).toEqual({ do: "move", stage: "submitted" });
  });
  it("writes money the way the owner reads it", () => {
    expect(rfpMoney(2_100_000)).toBe("AED 2.1M");
    expect(rfpMoney(600_000)).toBe("AED 600K");
    expect(rfpMoney(2_000_000)).toBe("AED 2M");
    expect(rfpMoney(950)).toBe("AED 950");
  });
  it("adds up the figures across the top", () => {
    const list = [
      rfp("new", { value: 900_000, deadline: day(24), receivedAt: day(-2) }),
      rfp("go", { stage: "in_response", value: 1_400_000, deadline: day(5) }),
      rfp("held", {
        stage: "in_response",
        heldAt: day(-9),
        holdReason: "Waiting for data",
      }),
      rfp("won", { stage: "won", value: 2_100_000, closedAt: day(-18) }),
      rfp("lost", { stage: "lost", value: 600_000, closedAt: day(-32) }),
    ];
    const stats = rfpStats(list, (id) => id.toUpperCase(), now);
    expect(stats.total).toEqual({
      count: 5,
      line: "3 open, 2 closed",
      detail: "AED 2.3M open value",
    });
    expect(stats.new.detail).toBe("Oldest received 2 days ago");
    expect(stats.inProgress).toMatchObject({
      count: 1,
      line: "Next due in 5 days",
      detail: "GO",
    });
    expect(stats.onHold).toEqual({
      count: 1,
      line: "Paused 9 days",
      detail: "Waiting for data",
    });
    expect(stats.won.line).toBe("AED 2.1M won");
    expect(stats.lost.detail).toBe("Last: LOST");
    expect(stats.winRate).toEqual({ percent: 50, line: "1 of 2 decided" });
    expect(rfpStats([], String, now).winRate.percent).toBeNull();
  });
  it("lists what needs attention: due within a week first, then on hold", () => {
    expect(
      rfpAttention(
        [
          rfp("held", { heldAt: day(-1), holdReason: "Waiting" }),
          rfp("soon", { stage: "in_response", deadline: day(5) }),
          rfp("later", { deadline: day(30) }),
          rfp("sent", { stage: "submitted", deadline: day(2) }),
          rfp("won", { stage: "won", deadline: day(1) }),
        ],
        now,
      ),
    ).toEqual([
      { id: "soon", kind: "due", line: "Submission due in 5 days" },
      { id: "held", kind: "hold", line: "On hold: Waiting" },
    ]);
  });
  it("names everyone on a bid once", () => {
    expect(
      rfpPeople(
        rfp("a", {
          responseOwner: "Sara",
          presales: "Omar",
          team: ["Sara", "Lina"],
        }),
      ),
    ).toEqual(["Sara", "Omar", "Lina"]);
  });
});

describe("a Portfolio card", () => {
  const work = (id: string, due: number | null, extra = {}) => ({
    id,
    type: "project",
    status: "active",
    dueAt: due === null ? null : day(due),
    lastContextAt: null,
    createdAt: day(-100),
    ...extra,
  });
  it("counts the days and flags a date that is near or past", () => {
    expect(portfolioCard(work("a", 14), now)).toMatchObject({
      daysText: "14",
      daysLabel: "days left",
      atRisk: true,
      line: "Due in 14 days",
    });
    expect(portfolioCard(work("a", 40), now).atRisk).toBe(false);
    expect(portfolioCard(work("a", -3), now)).toMatchObject({
      daysText: "3",
      daysLabel: "days late",
      atRisk: true,
    });
    expect(portfolioCard(work("a", null), now)).toMatchObject({
      daysText: "—",
      atRisk: false,
      line: "No date set",
    });
  });
  it("uses the progress when it is known", () => {
    const behind = { donePercent: 24, line: "5 in development" };
    expect(portfolioCard(work("a", 14), now, behind).line).toBe(
      "Due in 14 days · 76% of the work not done",
    );
    expect(
      portfolioCard(work("a", 14), now, { donePercent: 90, line: "2 to do" }),
    ).toMatchObject({ atRisk: false, line: "2 to do" });
  });
  it("puts the ones at risk first, then the nearest date", () => {
    expect(
      portfolioOrder(
        [
          work("far", 60),
          work("none", null),
          work("late", -2),
          work("near", 10),
        ],
        now,
      ).map((item) => item.id),
    ).toEqual(["late", "near", "far", "none"]);
  });
});
