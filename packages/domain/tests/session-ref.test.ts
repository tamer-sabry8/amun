import { it, expect } from "vitest";
import {
  parseCli,
  parseSessionReference,
  sessionReference,
} from "../src/session-ref.ts";

const id = "6b1f02c4-9a3e-4c1d-8f2a-0123456789ab";

it("round-trips a session reference and refuses anything else", () => {
  expect(sessionReference(id)).toBe("amun://session/" + id);
  expect(parseSessionReference(" amun://session/" + id + " ")).toBe(id);
  expect(parseSessionReference(id)).toBe(id);
  expect(() => parseSessionReference("amun://session/../etc")).toThrow();
  expect(() => sessionReference("x")).toThrow();
});

it("parses each command, its options and JSON mode", () => {
  expect(parseCli([])).toEqual({ name: "help", json: false });
  expect(parseCli(["status", id, "--json"])).toEqual({
    name: "status",
    session: id,
    json: true,
  });
  expect(
    parseCli(["events", id, "--source", "tool", "--source", "error"]),
  ).toEqual({
    name: "events",
    session: id,
    json: false,
    sources: ["tool", "error"],
  });
  expect(parseCli(["search", id, "failing", "tests"])).toMatchObject({
    name: "search",
    text: "failing tests",
  });
  expect(
    parseCli(["say", "amun://session/" + id, "Use", "30", "days"]),
  ).toMatchObject({ name: "say", session: id, text: "Use 30 days" });
  expect(parseCli(["decide", id, "evt-1", "reject", "Too", "risky"])).toEqual({
    name: "decide",
    session: id,
    eventId: "evt-1",
    decision: "reject",
    text: "Too risky",
    json: false,
  });
});

it("explains what is wrong with a bad command", () => {
  expect(() => parseCli(["launch", id])).toThrow(/Unknown command "launch"/);
  expect(() => parseCli(["status"])).toThrow(/session reference/);
  expect(() => parseCli(["status", "nope"])).toThrow(/not a session reference/);
  expect(() => parseCli(["say", id])).toThrow(/message to add/);
  expect(() => parseCli(["search", id])).toThrow(/words to search/);
  expect(() => parseCli(["decide", id, "evt", "maybe"])).toThrow(
    /approve\|reject/,
  );
  expect(() => parseCli(["status", id, "--force"])).toThrow(
    /Unknown option --force/,
  );
  expect(() => parseCli(["events", id, "--source"])).toThrow(/needs a value/);
});
