import { afterEach, describe, expect, it } from "vitest";
import {
  finishInFlight,
  formatElapsed,
  inFlight,
  inFlightState,
  observeInFlight,
  setInFlightPhase,
  startInFlight,
} from "../src/rebuild/firstmate.ts";

describe("in-flight Firstmate turn visibility across navigation", () => {
  afterEach(() => {
    finishInFlight("ontology");
  });

  it("tracks starting -> working -> done and notifies subscribers", () => {
    let calls = 0;
    const stop = observeInFlight(() => {
      calls++;
    });
    expect(inFlightState("ontology")).toBeNull();
    expect(inFlight.has("ontology")).toBe(false);

    startInFlight("ontology", "starting", 1000);
    expect(inFlight.has("ontology")).toBe(true);
    expect(inFlightState("ontology")).toEqual({
      phase: "starting",
      startedAt: 1000,
    });

    setInFlightPhase("ontology", "working");
    expect(inFlightState("ontology")).toEqual({
      phase: "working",
      startedAt: 1000,
    });
    // No-op phase update does not notify again.
    const before = calls;
    setInFlightPhase("ontology", "working");
    expect(calls).toBe(before);

    finishInFlight("ontology");
    expect(inFlight.has("ontology")).toBe(false);
    expect(inFlightState("ontology")).toBeNull();
    expect(calls).toBe(3);
    stop();
  });

  it("formats elapsed duration cleanly after 10 seconds", () => {
    expect(formatElapsed(0)).toBeNull();
    expect(formatElapsed(9_999)).toBeNull();
    expect(formatElapsed(10_000)).toBe("10s");
    expect(formatElapsed(59_400)).toBe("59s");
    expect(formatElapsed(60_000)).toBe("1m 0s");
    expect(formatElapsed(221_000)).toBe("3m 41s");
  });
});
