import { it, expect } from "vitest";
import {
  applyMasks,
  compareCaptures,
  describePosition,
  feedbackMessage,
  sanitizeCapture,
} from "../src/element-feedback.ts";

const raw = {
  url: "file:///Users/x/proto/index.html?secret=1",
  selector: "#total",
  label: "",
  rect: { x: 10, y: 700, width: 100, height: 50 },
  viewport: { width: 1000, height: 800 },
  styles: { width: "100px", "x-evil": "url(javascript:1)", color: 7 },
  consoleErrors: ["a", 5, "b"],
  nearby: Array.from({ length: 30 }, (_, i) => "Item " + i),
};

it("bounds every field, drops unknown styles and falls back to the selector as label", () => {
  const capture = sanitizeCapture(raw);
  expect(capture.url).toBe("file:///Users/x/proto/index.html");
  expect(capture.label).toBe("#total");
  expect(capture.styles).toEqual({ width: "100px" });
  expect(capture.consoleErrors).toEqual(["a", "b"]);
  expect(capture.nearby).toHaveLength(12);
  expect(capture.role).toBeUndefined();
  expect(
    sanitizeCapture({
      ...raw,
      url: "nonsense",
      rect: { ...raw.rect, x: Infinity },
    }),
  ).toMatchObject({
    url: "",
    rect: { x: 0 },
  });
  expect(() => sanitizeCapture(null)).toThrow();
});

it("describes position by thirds and handles a missing viewport", () => {
  expect(describePosition(sanitizeCapture(raw))).toBe(
    "100×50 at 10,700, bottom left of a 1000×800 view",
  );
  expect(
    describePosition(
      sanitizeCapture({
        ...raw,
        rect: { x: 450, y: 380, width: 100, height: 40 },
      }),
    ),
  ).toContain("middle centre");
  expect(describePosition(sanitizeCapture({ ...raw, viewport: {} }))).toBe(
    "100×50 at 10,700",
  );
});

it("masks text everywhere and leaves an untouched element alone", () => {
  const capture = sanitizeCapture({
    ...raw,
    label: "Total for Acme",
    text: "Acme owes 5",
    screenshotRef: "c/1.png",
    nearby: ["Acme Ltd"],
  });
  const masked = applyMasks(capture, [
    { text: "Acme" },
    { text: "" },
    { rect: { x: 900, y: 0, width: 10, height: 10 } },
  ]);
  expect(masked).toMatchObject({
    label: "Total for [hidden]",
    text: "[hidden] owes 5",
    nearby: ["[hidden] Ltd"],
    screenshotRef: "c/1.png",
  });
  expect(masked.maskedAreas).toHaveLength(1);
  const message = feedbackMessage(masked, "Match the brand pattern", "design");
  expect(message).not.toContain("Acme");
  expect(message).toContain("1 area was masked");
  expect(() => feedbackMessage(masked, "  ", "design")).toThrow();
});

it("reports nothing when before and after are the same", () => {
  const capture = sanitizeCapture(raw);
  expect(compareCaptures(capture, capture)).toEqual({
    changes: [],
    errorsFixed: [],
    errorsNew: [],
  });
  const after = sanitizeCapture({
    ...raw,
    text: "New",
    rect: { ...raw.rect, width: 120 },
  });
  expect(compareCaptures(capture, after).changes.map((c) => c.field)).toEqual([
    "text",
    "size",
  ]);
});
