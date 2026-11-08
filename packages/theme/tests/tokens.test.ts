import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contrast, colorHex } from "../src/contrast.ts";
const themes = ["tamer-sabry-default", "navy-gold", "navy-cyan"];
it("meets text and interactive contrast in every theme and never overrides locked safety tokens", () => {
  const safety = JSON.parse(readFileSync("tokens/safety.json", "utf8"));
  for (const name of themes) {
    const tokens = JSON.parse(readFileSync(`tokens/${name}.json`, "utf8"));
    expect(tokens.safety).toBeUndefined();
    const c = (key: string) => colorHex(tokens.color[key].$value);
    for (const background of ["canvas", "navigation", "card"]) {
      expect(contrast(c("text"), c(background))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c("supporting"), c(background))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(c("control-border"), c(background)),
      ).toBeGreaterThanOrEqual(3);
    }
    for (const background of ["button-start", "button-end"])
      expect(contrast(c("button-text"), c(background))).toBeGreaterThanOrEqual(
        4.5,
      );
    for (const role of ["approval", "destructive"])
      expect(
        contrast(
          colorHex(safety.safety[role].text.$value),
          colorHex(safety.safety[role].background.$value),
        ),
      ).toBeGreaterThanOrEqual(4.5);
  }
});
it("validates colour inputs and exact contrast extremes", () => {
  expect(contrast("#000000", "#ffffff")).toBe(21);
  expect(contrast("#123456", "#123456")).toBe(1);
  expect(() => contrast("red", "#ffffff")).toThrow();
  expect(() =>
    colorHex({ colorSpace: "srgb", components: [2, 0, 0] }),
  ).toThrow();
});
