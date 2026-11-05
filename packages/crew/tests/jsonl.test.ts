import { describe, expect, it } from "vitest";
import { JsonLineDecoder } from "../src/jsonl.js";

describe("Pi JSONL framing", () => {
  it("buffers partial frames and delivers multiple frames in order", () => {
    const decoder = new JsonLineDecoder();
    expect(decoder.push('{"id":')).toEqual([]);
    expect(decoder.push('"a"}\n{"id":"b"}\n')).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });
  it("does not split on Unicode line separators in model content", () => {
    const decoder = new JsonLineDecoder();
    expect(decoder.push('{"text":"a\u2028b\u2029c"}\n')).toEqual([
      { text: "a\u2028b\u2029c" },
    ]);
  });
  it("ignores blank lines and accepts CRLF", () => {
    expect(new JsonLineDecoder().push('\n{"ok":true}\r\n')).toEqual([
      { ok: true },
    ]);
  });
  it("rejects malformed JSON and clears poisoned input", () => {
    const decoder = new JsonLineDecoder();
    expect(() => decoder.push("invalid\n")).toThrow();
    expect(decoder.push('{"ok":true}\n')).toEqual([{ ok: true }]);
  });
  it("bounds unterminated frames and completed frames", () => {
    expect(() => new JsonLineDecoder(8).push("123456789")).toThrow(RangeError);
    expect(() => new JsonLineDecoder(8).push("123456789\n")).toThrow(
      RangeError,
    );
  });
  it("does not mistake an incomplete final frame for a response", () => {
    const decoder = new JsonLineDecoder();
    decoder.push('{"partial":');
    expect(() => decoder.finish()).toThrow();
    expect(new JsonLineDecoder().finish()).toBeUndefined();
  });
});
