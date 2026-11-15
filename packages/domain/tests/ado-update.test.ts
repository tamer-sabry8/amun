import { describe, expect, it } from "vitest";
import { adoWorkItemOf } from "../src/ado-update.ts";

describe("adoWorkItemOf", () => {
  it("reads a number, a #number or a work item link", () => {
    for (const value of [
      "123",
      "#123",
      123,
      "https://dev.azure.com/o/p/_workitems/edit/123",
    ])
      expect(adoWorkItemOf({ "Work item": value })).toEqual({
        named: true,
        id: 123,
      });
  });
  it("is not an update when no item is named, and flags an unreadable one", () => {
    expect(adoWorkItemOf({ Title: "x" }).named).toBe(false);
    expect(adoWorkItemOf({ workitem: "soon" })).toMatchObject({ named: true });
    expect(adoWorkItemOf({ workitem: "soon" }).id).toBeFalsy();
  });
});
