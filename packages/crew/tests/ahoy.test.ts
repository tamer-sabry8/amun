import { expect, it } from "vitest";
import { ahoyRecap } from "../src/ahoy.ts";
import { Redactor } from "../../security/src/redaction.ts";
const message = (role: string, text: string) => ({
  type: "message",
  message: { role, content: [{ type: "text", text }] },
});
it("takes Bearings for the first captain message and excludes operational wakes", () => {
  expect(
    ahoyRecap([message("user", "\u2063FIRSTMATE_OP: wake")], new Redactor()),
  ).toBeNull();
});
it("only recaps visible replies after the last captain message", () => {
  const r = ahoyRecap(
    [
      message("assistant", "earlier"),
      message("user", "Update?"),
      message("toolResult", "private"),
      message("assistant", "Both workers returned."),
      message("user", "\u2063FIRSTMATE_OP: check"),
    ],
    new Redactor(),
  );
  expect(r).toContain("Both workers returned.");
  expect(r).not.toMatch(/earlier|private|FIRSTMATE_OP/);
});
