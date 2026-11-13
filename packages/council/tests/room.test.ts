import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeRoom, Room } from "../src/room.ts";

// A stand-in for the room app with the same contract Amun relies on:
// it listens on PORT at 127.0.0.1 and answers GET /api/seats.
const server = `
import http from "node:http";
const seats = JSON.parse(process.env.TEST_SEATS ?? '["alpha","beta"]');
if (process.env.TEST_CRASH) process.exit(3);
http
  .createServer((request, response) => {
    if (request.url === "/api/seats") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ seats: seats.map((key) => ({ key })), runner: process.env.COUNCIL_RUNNER }));
    } else {
      response.writeHead(404);
      response.end();
    }
  })
  .listen(Number(process.env.PORT), "127.0.0.1");
`;
let dir: string;
const rooms: Room[] = [];
const room = (env: Record<string, string> = {}, timeoutMs = 4000) => {
  const instance = new Room(dir, { node: process.execPath, env, timeoutMs });
  rooms.push(instance);
  return instance;
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "amun-room-"));
  await mkdir(join(dir, "app"), { recursive: true });
  await writeFile(join(dir, "app/server.mjs"), server);
});
afterEach(async () => {
  for (const instance of rooms.splice(0)) instance.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("Council room", () => {
  it("starts on a loopback port as a viewer and stops cleanly", async () => {
    const instance = room();
    expect(instance.url).toBeNull();
    const url = await instance.start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(await instance.start()).toBe(url);
    const body = await (await fetch(url + "api/seats")).json();
    // Viewer only: the room is never allowed to run councils by itself.
    expect(body.runner).toBe("viewer");
    expect(await instance.seatKeys()).toEqual(["alpha", "beta"]);
    instance.stop();
    expect(instance.url).toBeNull();
  });
  it("validates that the room shows the composed roster", async () => {
    const options = { node: process.execPath, timeoutMs: 4000 };
    expect(await probeRoom(dir, ["alpha", "beta"], options)).toEqual([]);
    expect(await probeRoom(dir, ["alpha"], options)).toEqual([
      "The room does not show the same advisors as the roster.",
    ]);
    expect(
      await probeRoom(dir, ["gamma"], {
        ...options,
        env: { TEST_SEATS: '["gamma"]' },
      }),
    ).toEqual([]);
  });
  it("reports a room that crashes or never answers", async () => {
    await expect(room({ TEST_CRASH: "1" }).start()).rejects.toThrow(
      "The room stopped before it was ready.",
    );
    await writeFile(
      join(dir, "app/server.mjs"),
      "setInterval(() => {}, 1000);",
    );
    await expect(room({}, 300).start()).rejects.toThrow(
      "The room did not start in time.",
    );
    expect(
      await probeRoom(dir, [], { node: process.execPath, timeoutMs: 200 }),
    ).toEqual(["The room did not start in time."]);
  });
});
