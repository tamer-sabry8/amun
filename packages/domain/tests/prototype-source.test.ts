import { describe, expect, it } from "vitest";
import { previewSource } from "../src/work/prototype-source.ts";

describe("previewSource", () => {
  it("opens a whole HTML page or an html block of a prototype", () => {
    expect(previewSource("prototype", "<!DOCTYPE html><p>Hi</p>")).toEqual({
      kind: "html",
      html: "<!DOCTYPE html><p>Hi</p>",
    });
    expect(
      previewSource("prototype", "Here:\n```html\n<p>Hi</p>\n```\nDone"),
    ).toEqual({ kind: "html", html: "<p>Hi</p>" });
  });
  it("opens only a link to this Mac's own server", () => {
    expect(
      previewSource("prototype", "Running at http://localhost:5173/app."),
    ).toEqual({ kind: "url", url: "http://localhost:5173/app." });
    expect(previewSource("prototype", "See https://example.com/x")).toBeNull();
    expect(
      previewSource("prototype", "http://user:pw@localhost:3000/"),
    ).toBeNull();
  });
  it("offers nothing for other kinds of item", () => {
    expect(previewSource("doc", "<!doctype html><p>Hi</p>")).toBeNull();
    expect(previewSource("prototype", "Just notes")).toBeNull();
  });
});
