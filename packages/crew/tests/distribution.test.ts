import { describe, expect, it } from "vitest";
import { verifyDistributionArchive } from "../src/distribution.js";

describe("pinned executable distribution integrity", () => {
  const digest =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  it("accepts only the exact pinned bytes", () => {
    expect(() =>
      verifyDistributionArchive(Buffer.from("abc"), digest),
    ).not.toThrow();
  });
  it.each([Buffer.from("abd"), Buffer.alloc(0)])(
    "refuses changed or empty content %#",
    (bytes) => {
      expect(() => verifyDistributionArchive(bytes, digest)).toThrow();
    },
  );
  it.each(["", "latest", "a".repeat(63)])(
    "rejects invalid hash metadata %j",
    (digest) => {
      expect(() =>
        verifyDistributionArchive(Buffer.from("abc"), digest),
      ).toThrow();
    },
  );
});
