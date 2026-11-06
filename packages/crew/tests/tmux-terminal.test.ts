import { it, expect } from "vitest";
import { clientControlArguments } from "../src/tmux-terminal.ts";
it("toggles only the uniquely identified PTY client when its current state differs", () => {
  expect(
    clientControlArguments(123, "123|/dev/ttys012|1\n456|/dev/ttys013|0", true),
  ).toEqual(["switch-client", "-E", "-c", "/dev/ttys012", "-r"]);
  expect(clientControlArguments(123, "123|/dev/ttys012|0", false)).toEqual([
    "switch-client",
    "-E",
    "-c",
    "/dev/ttys012",
    "-r",
  ]);
  expect(clientControlArguments(123, "123|/dev/ttys012|0", true)).toEqual([]);
  expect(clientControlArguments(123, "123|/dev/ttys012|1", false)).toEqual([]);
});
it("refuses missing, ambiguous and malformed client identities or states", () => {
  for (const clients of [
    "456|/dev/ttys012|1",
    "123|/dev/ttys012|1\n123|/dev/ttys013|1",
    "123|/tmp/unsafe|1",
    "123|/dev/ttys012|extra",
    "123|/dev/ttys012|2",
    "x".repeat(65537),
  ])
    expect(() => clientControlArguments(123, clients, true)).toThrow();
});
