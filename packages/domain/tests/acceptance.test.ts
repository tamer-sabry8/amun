import { expect, it } from "vitest";
import {
  checklistSummary,
  normalizeChecklist,
} from "../src/work/acceptance.ts";

it("keeps cited items and marks the rest unknown, never passed", () => {
  const body = [
    "# Checklist",
    "- [x] Login works — Evidence: test run 412 passed",
    "- [x] Export works",
    "- [x] Billing works. Evidence: unknown",
    "- [ ] Docs updated; Evidence: PR 31",
    "Plain line",
  ].join("\n");
  expect(normalizeChecklist(body).split("\n")).toEqual([
    "# Checklist",
    "- [x] Login works — Evidence: test run 412 passed",
    "- [ ] Export works — Evidence: unknown",
    "- [ ] Billing works. — Evidence: unknown",
    "- [ ] Docs updated; Evidence: PR 31",
    "Plain line",
  ]);
});

it("counts items with and without evidence", () => {
  expect(
    checklistSummary(
      "- [ ] A — Evidence: PR 1\n- [ ] B\n- [x] C — Evidence: none\nText",
    ),
  ).toEqual({ items: 3, unknown: 2, cited: 1 });
});
