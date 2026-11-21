import { expect, it } from "vitest";
import {
  requiredInputs,
  storyTextFields,
} from "../src/ado-publication-fields.ts";
const field = (referenceName: string, defaultValue: string | null = null) => ({
  name: referenceName,
  referenceName,
  required: true,
  defaultValue,
  allowedValues: [],
});
it("blocks unknown required values, accepts numeric zero, supplied paths and discovered defaults", () => {
  const type = {
    name: "Task",
    states: ["New"],
    fields: [
      field("System.AreaId"),
      field("System.IterationId"),
      field("System.State", "New"),
      field("Estimate"),
      field("Custom.Signoff"),
    ],
  };
  const supplied = {
    "System.AreaPath": "Library",
    "System.IterationPath": "Library",
    Estimate: 0,
  };
  expect(requiredInputs(type, supplied)).toEqual(["Custom.Signoff"]);
  expect(
    requiredInputs(type, { ...supplied, "Custom.Signoff": "Approved" }),
  ).toEqual([]);
});

it("adds criteria once in the existing description section, before notes", () => {
  const fields = [field("System.Description")];
  expect(
    storyTextFields(
      fields,
      "Intro\nAcceptance criteria:\n- Existing\nNotes:\nRetain this",
      ["Existing", "Allow <badge>", "Allow <badge>"],
    ),
  ).toEqual({
    "System.Description":
      "<p>Intro<br>Acceptance criteria:<br>- Existing</p><ul><li>Allow &lt;badge&gt;</li></ul><p>Notes:<br>Retain this</p>",
  });
  expect(
    storyTextFields(fields, "Intro", ["Works"])["System.Description"],
  ).toBe("<p>Intro</p><h3>Acceptance criteria</h3><ul><li>Works</li></ul>");
  expect(() => storyTextFields([], "", ["Required"])).toThrow("No Azure field");
});
