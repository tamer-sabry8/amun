import { describe, expect, it } from "vitest";
import { storiesView } from "../src/rebuild/stories-view.tsx";

const summary = {
  workAreaId: "area",
  productId: "p",
  delivery: true,
  requirements: {
    label: "BRD" as const,
    version: 2,
    approved: true,
    deliveredAt: null,
  },
  items: [
    {
      id: "e1",
      type: "epic",
      title: "Customers",
      parentId: null,
      status: "In progress",
      tool: "linear",
      key: "P-TRA-3",
    },
    {
      id: "s1",
      type: "story",
      title: "Add a customer",
      parentId: "e1",
      status: "Done",
      tool: "linear",
      key: "TRA-101",
    },
    {
      id: "s2",
      type: "story",
      title: "Import from CSV",
      parentId: "e1",
      status: "In progress",
      tool: "linear",
      key: "TRA-102",
    },
    {
      id: "s3",
      type: "story",
      title: "Merge duplicates",
      parentId: "e1",
      status: "draft",
      tool: null,
      key: null,
    },
    {
      id: "s4",
      type: "story",
      title: "Loose idea",
      parentId: null,
      status: "draft",
      tool: null,
      key: null,
    },
    {
      id: "s5",
      type: "story",
      title: "Cut",
      parentId: "e1",
      status: "Removed",
      tool: null,
      key: null,
    },
  ],
};
const sprints = [
  {
    id: "sp",
    workAreaId: "area",
    name: "Sprint 1",
    team: null,
    start: "2026-12-01T00:00:00Z",
    end: "2026-12-12T00:00:00Z",
    goal: "",
    draft: false,
    done: 0,
    total: 0,
    blocked: 0,
    changedInAdo: false,
    capacity: null,
    stories: [
      { id: "TRA-101", title: "Add a customer", points: 3, owner: null },
    ],
    out: [],
  },
];

describe("the Stories screen", () => {
  it("groups stories under their epic with progress, and counts Drafted and Published", () => {
    const view = storiesView(summary, sprints, "all");
    expect(view.counts).toEqual({ all: 4, drafted: 2, published: 2, done: 1 });
    expect(view.tools).toEqual(["Linear"]);
    expect(view.groups.map((g) => [g.title, g.done, g.total])).toEqual([
      ["Customers", 1, 3],
      ["Not in an epic", 0, 1],
    ]);
    const add = view.groups[0]!.stories.find((s) => s.id === "s1")!;
    expect(add).toMatchObject({
      published: true,
      key: "TRA-101",
      sprint: "Sprint 1",
    });
  });

  it("filters to drafted, published or done stories", () => {
    const titles = (filter: "drafted" | "published" | "done") =>
      storiesView(summary, sprints, filter).groups.flatMap((g) =>
        g.stories.map((s) => s.title),
      );
    expect(titles("drafted")).toEqual(["Merge duplicates", "Loose idea"]);
    expect(titles("published")).toEqual(["Add a customer", "Import from CSV"]);
    expect(titles("done")).toEqual(["Add a customer"]);
  });
});
