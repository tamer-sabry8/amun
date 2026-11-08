import { expect, it } from "vitest";
import { planStow } from "../src/stow-curation.ts";
const evidence = "Use blue for previews.";
const proposal = {
  file: "learnings.md" as const,
  previous: "- Use green for previews. <!--a:2026-11-01-->",
  text: evidence,
};
it("applies grounded ordinary edits once and preserves surrounding text", () => {
  const memory = {
    "learnings.md": "# Notes\n" + proposal.previous + "\n",
    "captain.md": "",
    "captain-shared.md": "",
  };
  const pass = planStow(memory, [proposal], evidence, "2026-11-08");
  expect(pass.memory["learnings.md"]).toBe(
    "# Notes\n- Use blue for previews. <!--a:2026-11-08-->\n",
  );
  expect(
    planStow(pass.memory, [proposal], evidence, "2026-11-08").memory,
  ).toEqual(pass.memory);
});
it("requires a separate decision for default and explicit pins, rejects ungrounded changes", () => {
  for (const [file, previous] of [
    ["captain.md", "- Use green."],
    ["learnings.md", "- Use green. <!--P-->"],
  ] as const) {
    const memory = {
      "learnings.md": "",
      "captain.md": "",
      "captain-shared.md": "",
      [file]: previous,
    };
    const pass = planStow(
      memory,
      [{ file, previous, text: evidence }],
      evidence,
      "2026-11-08",
    );
    expect(pass.memory).toEqual(memory);
    expect(pass.pins).toHaveLength(1);
    expect(
      planStow(
        memory,
        [{ file, previous, text: "Unrelated fact" }],
        evidence,
        "2026-11-08",
      ).pins,
    ).toEqual([]);
  }
});

it("gives unmarked learnings a grace pass and archives stale ordinary facts with provenance", async () => {
  const { ageLearnings } = await import("../src/stow-curation.ts");
  const raw =
    "- Old workflow <!--a:2026-09-01-->\n- New legacy fact\n- Pinned fact <!--P-->\n- Uncaptured <!--pending:records-->\n";
  const result = ageLearnings(raw, "", "2026-11-08");
  expect(result.text).toBe(
    "- New legacy fact <!--g-->\n- Pinned fact <!--P-->\n- Uncaptured <!--pending:records-->\n",
  );
  expect(result.archive).toEqual([
    "- (from learnings.md, tier: aging, reinforced: 2026-09-01) Old workflow [archived: unreinforced]",
  ]);
  expect(
    ageLearnings(
      "- Old workflow <!--a:2026-09-01-->\n",
      "Old workflow",
      "2026-11-08",
    ).text,
  ).toContain("<!--a:2026-11-08-->");
});

it("preserves pins with trailing whitespace and ambiguous compound tier markers", () => {
  for (const previous of [
    "- Existing <!--P-->  ",
    "- Existing <!--P--> <!--a:2026-11-01-->",
  ]) {
    const memory = {
      "learnings.md": previous,
      "captain.md": "",
      "captain-shared.md": "",
    };
    const result = planStow(
      memory,
      [{ file: "learnings.md", previous, text: evidence }],
      evidence,
      "2026-11-08",
    );
    expect(result.memory).toEqual(memory);
  }
});
