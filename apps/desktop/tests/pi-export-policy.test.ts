import { it, expect } from "vitest";
import { exportRequest } from "../src/pi-export-policy.ts";
it("accepts reviewed bounded text and format but never renderer-supplied paths or publication", () => {
  expect(exportRequest({ id: "x", format: "jsonl", text: "{}\n" })).toEqual({
    id: "x",
    format: "jsonl",
    text: "{}\n",
  });
  for (const value of [
    null,
    { id: "x", format: "html", text: "a", path: "/personal" },
    { id: "x", format: "exe", text: "a" },
    { id: "x", format: "html", text: "a".repeat(524289) },
    { id: "x", format: "html", text: "\0" },
  ])
    expect(exportRequest(value)).toBeNull();
});
