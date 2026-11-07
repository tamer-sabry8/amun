import { it, expect } from "vitest";
import { terminalDocument } from "../src/terminal-document.ts";
it("adds the shell style nonce only to xterm-created styles without modifying the global document", () => {
  const original = {
    createElement: (tag: string) => ({ tag, nonce: "" }),
    marker: 1,
  };
  const document = terminalDocument(
    original as unknown as Document,
    "abcdefghijklmnopqrstuvwx",
  );
  expect(document.createElement("style").nonce).toBe(
    "abcdefghijklmnopqrstuvwx",
  );
  expect(document.createElement("div").nonce).toBe("");
  expect(original.createElement("style").nonce).toBe("");
  expect(() =>
    terminalDocument(original as unknown as Document, "bad nonce"),
  ).toThrow();
});
