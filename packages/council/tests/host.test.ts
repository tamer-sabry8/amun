import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chairFailure, findClaude, shippedPin } from "../src/host.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "amun-council-host-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("hosting the Council", () => {
  it("says why the Chair stopped, in Claude Code's own words", async () => {
    const output = join(dir, "chair-output.jsonl");
    await writeFile(
      output,
      [
        JSON.stringify({ type: "system", subtype: "init" }),
        "not json",
        JSON.stringify({
          type: "result",
          is_error: true,
          result: "Failed to authenticate: this login reached its time limit.",
        }),
      ].join("\n") + "\n",
    );
    expect(await chairFailure(output)).toBe(
      "Failed to authenticate: this login reached its time limit.",
    );
  });

  it("gives no reason for a Chair that finished, or that left no output", async () => {
    const output = join(dir, "chair-output.jsonl");
    await writeFile(
      output,
      JSON.stringify({ type: "result", is_error: false, result: "Done." }),
    );
    expect(await chairFailure(output)).toBeNull();
    expect(await chairFailure(join(dir, "missing.jsonl"))).toBeNull();
  });

  it("finds Claude Code in its usual place or on the PATH, and nowhere else", async () => {
    const bin = join(dir, "bin");
    await mkdir(bin);
    expect(await findClaude(dir, bin)).not.toBe(join(bin, "claude"));
    await writeFile(join(bin, "claude"), "#!/bin/sh\n");
    await chmod(join(bin, "claude"), 0o755);
    const home = join(dir, "home");
    await mkdir(join(home, ".local/bin"), { recursive: true });
    await writeFile(join(home, ".local/bin/claude"), "#!/bin/sh\n");
    await chmod(join(home, ".local/bin/claude"), 0o755);
    // The usual install place wins over the PATH.
    expect(await findClaude(home, bin)).toBe(join(home, ".local/bin/claude"));
  });

  it("accepts only a well-formed pin for the shipped version", async () => {
    expect(shippedPin(null)).toBeNull();
    expect(shippedPin(dir)).toBeNull();
    const commit = "e40f40652d5690c4d9f928c4794c673a99f2cd0e";
    await writeFile(
      join(dir, "pin.json"),
      JSON.stringify({ repository: "r", commit, sha256: "short" }),
    );
    expect(shippedPin(dir)).toBeNull();
    await writeFile(
      join(dir, "pin.json"),
      JSON.stringify({ repository: "r", commit, sha256: "a".repeat(64) }),
    );
    expect(shippedPin(dir)?.directory).toBe(join(dir, commit));
  });
});
