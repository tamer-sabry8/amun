import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fleetSnapshotSchema, type FleetSnapshot } from "@getpaseo/protocol/amun-rpc";
import { FleetSnapshotNotReadyError, shareFleetSnapshots } from "./firstmate-cli.js";

const fixture: FleetSnapshot = fleetSnapshotSchema.parse(
  JSON.parse(
    readFileSync(new URL("./fixtures/fleet-snapshot.json", import.meta.url), "utf8"),
  ),
);

interface PendingRead {
  resolve(snapshot: FleetSnapshot): void;
  reject(error: Error): void;
}

function slowReader() {
  const pending: PendingRead[] = [];
  const readOnce = () =>
    new Promise<FleetSnapshot>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  return { pending, readOnce };
}

describe("shared fleet snapshots", () => {
  it("runs the script once while a read is still going, however many callers ask", async () => {
    const { pending, readOnce } = slowReader();
    const snapshots = shareFleetSnapshots(readOnce);

    const callers = [
      snapshots.readFresh("/home"),
      snapshots.read("/home"),
      snapshots.readFresh("/home"),
    ];
    expect(pending).toHaveLength(1);

    pending[0].resolve(fixture);
    expect(await Promise.all(callers)).toEqual([fixture, fixture, fixture]);
  });

  it("answers from the last snapshot at once and refreshes it behind the caller", async () => {
    const { pending, readOnce } = slowReader();
    let clock = 0;
    const snapshots = shareFleetSnapshots(readOnce, { freshMs: 5_000, now: () => clock });

    const first = snapshots.readFresh("/home");
    pending[0].resolve(fixture);
    await first;

    clock = 60_000;
    expect(await snapshots.read("/home")).toBe(fixture);
    expect(pending).toHaveLength(2);
  });

  it("starts a new read after a failed one", async () => {
    const { pending, readOnce } = slowReader();
    const snapshots = shareFleetSnapshots(readOnce);

    const failed = snapshots.readFresh("/home");
    pending[0].reject(new Error("fm-fleet-snapshot.sh failed"));
    await expect(failed).rejects.toThrow("fm-fleet-snapshot.sh failed");

    const retry = snapshots.readFresh("/home");
    expect(pending).toHaveLength(2);
    pending[1].resolve(fixture);
    expect(await retry).toBe(fixture);
  });

  it("never holds the screen for the first snapshot of a slow home", async () => {
    const { pending, readOnce } = slowReader();
    const snapshots = shareFleetSnapshots(readOnce, { firstWaitMs: 10 });

    await expect(snapshots.read("/home")).rejects.toBeInstanceOf(FleetSnapshotNotReadyError);
    // The read carries on, and the next caller shares it.
    const later = snapshots.readFresh("/home");
    expect(pending).toHaveLength(1);
    pending[0].resolve(fixture);
    expect(await later).toBe(fixture);
    expect(await snapshots.read("/home")).toBe(fixture);
  });

  it("rests after a slow read for as long as the read took", async () => {
    const { pending, readOnce } = slowReader();
    let clock = 0;
    const snapshots = shareFleetSnapshots(readOnce, { freshMs: 5_000, now: () => clock });

    const first = snapshots.readFresh("/home");
    clock = 110_000;
    pending[0].resolve(fixture);
    await first;

    clock = 200_000;
    expect(await snapshots.readFresh("/home")).toBe(fixture);
    expect(pending).toHaveLength(1);

    clock = 221_000;
    void snapshots.readFresh("/home");
    expect(pending).toHaveLength(2);
  });

  it("shows what was kept from the last run at once, then replaces and keeps the new one", async () => {
    const { pending, readOnce } = slowReader();
    const kept: FleetSnapshot[] = [];
    const older = { ...fixture, generated: "2026-11-17T08:00:00Z" };
    const snapshots = shareFleetSnapshots(readOnce, {
      load: () => older,
      save: (_home, snapshot) => void kept.push(snapshot),
    });

    expect(await snapshots.read("/home")).toBe(older);
    // The home is read again behind the caller.
    expect(pending).toHaveLength(1);
    pending[0].resolve(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await snapshots.read("/home")).toBe(fixture);
    expect(kept).toEqual([fixture]);
  });

  it("keeps homes apart", () => {
    const { pending, readOnce } = slowReader();
    const snapshots = shareFleetSnapshots(readOnce);
    void snapshots.readFresh("/one");
    void snapshots.readFresh("/two");
    expect(pending).toHaveLength(2);
  });
});
