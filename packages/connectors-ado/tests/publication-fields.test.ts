import { expect, it } from "vitest";
import { requiredInputs } from "../src/publication-fields.ts";
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
