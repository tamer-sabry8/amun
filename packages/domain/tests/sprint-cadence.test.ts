import { expect, it } from "vitest";
import { nextSprintDetails } from "../src/work/planning.ts";

it("suggests an editable name and dates from the selected team's two matching sprints", () => {
  const older = {
      name: "Gitex Sprint 2",
      start: "2026-11-02",
      end: "2026-11-06",
    },
    later = { name: "Gitex Sprint 3", start: "2026-11-16", end: "2026-11-20" };
  expect(nextSprintDetails([older, later])).toEqual({
    name: "Gitex Sprint 4",
    start: "2026-11-30",
    end: "2026-12-04",
  });
  for (const history of [
    [later],
    [older, { ...later, end: "" }],
    [older, { ...later, end: "2026-11-21" }],
  ])
    expect(nextSprintDetails(history)).toMatchObject({ start: "", end: "" });
});
