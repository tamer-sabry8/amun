import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterCleanExit,
  planGraphics,
  readGraphicsState,
  writeGraphicsState,
  type GraphicsState,
} from "../src/graphics-mode.ts";

const v = "0.1.0";
/** One launch: plan from what is on disk, then exit cleanly or not. */
function launch(previous: unknown, clean: boolean, version = v): GraphicsState {
  const state = planGraphics(previous, version);
  return clean ? afterCleanExit(state) : state;
}

describe("graphics mode", () => {
  it("runs graphics in the main process on a first launch and after clean exits", () => {
    const first = launch(undefined, true);
    expect(first).toEqual({
      version: v,
      mode: "in-process",
      running: false,
      failures: 0,
    });
    expect(planGraphics(first, v).mode).toBe("in-process");
  });

  it("uses the separate process for the launch after an unclean in-process exit", () => {
    const crashed = launch(undefined, false);
    const next = planGraphics(crashed, v);
    expect(next).toMatchObject({ mode: "separate", failures: 1 });
  });

  it("tries in-process again after one safe launch, and forgets the doubt when that exits cleanly", () => {
    const safe = launch(launch(undefined, false), true);
    expect(safe).toMatchObject({ mode: "separate", failures: 1 });
    const retry = launch(safe, true);
    expect(retry).toMatchObject({ mode: "in-process", failures: 0 });
  });

  it("stays separate for this version after a second unclean in-process exit", () => {
    let state = launch(undefined, false); // in-process, unclean
    state = launch(state, true); // separate, clean
    state = launch(state, false); // in-process again, unclean
    state = launch(state, true);
    expect(state).toMatchObject({ mode: "separate", failures: 2 });
    for (let i = 0; i < 3; i++) {
      state = launch(state, i % 2 === 0);
      expect(state.mode).toBe("separate");
    }
  });

  it("does not count an unclean exit of a separate-process launch", () => {
    const crashed = launch(undefined, false);
    const separateUnclean = launch(crashed, false);
    expect(separateUnclean).toMatchObject({ mode: "separate", failures: 1 });
    expect(planGraphics(separateUnclean, v)).toMatchObject({
      mode: "in-process",
      failures: 1,
    });
  });

  it("gives a new version a fresh start", () => {
    let state = launch(undefined, false);
    state = launch(state, true);
    state = launch(state, false);
    expect(planGraphics(state, v).mode).toBe("separate");
    expect(planGraphics(state, "0.2.0")).toMatchObject({
      mode: "in-process",
      failures: 0,
    });
  });

  it("honours an explicit request for the separate process without recording a failure", () => {
    expect(planGraphics(undefined, v, true)).toMatchObject({
      mode: "separate",
      failures: 0,
    });
  });

  it("treats unreadable or malformed records as a first launch", () => {
    for (const bad of [
      null,
      "x",
      [],
      { version: v },
      { version: v, mode: "other", running: true, failures: 0 },
      { version: v, mode: "in-process", running: "yes", failures: 0 },
      { version: v, mode: "in-process", running: true, failures: -1 },
      { version: v, mode: "in-process", running: true, failures: 1.5 },
    ])
      expect(planGraphics(bad, v)).toMatchObject({
        mode: "in-process",
        failures: 0,
      });
  });

  it("round-trips the record on disk and reads a damaged file as absent", () => {
    const root = mkdtempSync(join(tmpdir(), "amun-graphics-"));
    try {
      const file = join(root, "nested", "graphics-mode.json");
      expect(readGraphicsState(file)).toBeUndefined();
      const state = planGraphics(undefined, v);
      writeGraphicsState(file, state);
      expect(readGraphicsState(file)).toEqual(state);
      writeFileSync(file, "{not json");
      expect(readGraphicsState(file)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
