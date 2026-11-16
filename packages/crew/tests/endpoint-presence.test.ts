import { afterEach, beforeEach, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveEndpointReceipt } from "../src/endpoint-receipt.ts";
import { endpointPresence } from "../src/observe-owned-tmux.ts";

// A saved worker identity is only given up on when its absence is proven.
let root: string;
let socket: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "amun-presence-")));
  const scope = join(root, "scope");
  socket = join(scope, "tmux-501", "default");
  await mkdir(join(root, "receipts"), { mode: 0o700 });
  await mkdir(join(scope, "tmux-501"), { recursive: true });
  await saveEndpointReceipt(join(root, "receipts"), {
    version: 1,
    backend: "tmux",
    home: join(root, "home"),
    scope,
    socket,
    identity: {
      taskId: "amun-pi",
      window: "firstmate:fm-amun-pi",
      worktree: join(root, "work"),
      spawnGeneration: "a.1",
      paneId: "%2",
      windowId: "@2",
      serverPid: 123,
      panePid: 456,
      ownerToken: "a".repeat(32),
    },
  });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const check = (answers: Record<string, string | Error>) =>
  endpointPresence(
    join(root, "receipts"),
    "amun-pi",
    "/usr/bin/tmux",
    async (args) => {
      const key = args.includes("show-options") ? "owner" : "panes";
      const answer = answers[key] ?? "";
      if (answer instanceof Error) throw answer;
      return answer;
    },
  );
const token = "a".repeat(32);

it("reports no receipt, and a stopped server as gone", async () => {
  expect(
    await endpointPresence(
      join(root, "receipts"),
      "amun-none",
      "/usr/bin/tmux",
    ),
  ).toBe("none");
  expect(await check({})).toBe("gone");
});

it("reports gone when the server is up but the worker's pane is not", async () => {
  await writeFile(socket, "");
  expect(await check({ owner: token, panes: "%1|123|0\n" })).toBe("gone");
  expect(await check({ owner: token, panes: "%2|999|0\n" })).toBe("gone");
  expect(await check({ owner: token, panes: "%2|123|1\n" })).toBe("gone");
  expect(
    await check({
      owner: new Error("no server running on " + socket),
    }),
  ).toBe("gone");
});

it("never calls a possibly live worker gone", async () => {
  await writeFile(socket, "");
  expect(await check({ owner: token, panes: "%2|123|0\n" })).toBe("present");
  expect(await check({ owner: "b".repeat(32), panes: "" })).toBe("unknown");
  expect(await check({ owner: new Error("timed out") })).toBe("unknown");
  expect(await check({ owner: token, panes: "%2|123|0\n%2|123|0\n" })).toBe(
    "unknown",
  );
});

it("retires receipt, witness and launch marker under distinct names", async () => {
  const { retireEndpoint } = await import("../src/firstmate-dispatch.ts");
  const files = {
    "receipt.json": join(root, "a", "amun-pi.json"),
    "witness.json": join(root, "b", "amun-pi.json"),
    "launch.json": join(root, "amun-pi.launch"),
  };
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  for (const [name, path] of Object.entries(files)) await writeFile(path, name);
  const first = await retireEndpoint(root, "amun-pi", files);
  for (const name of Object.keys(files))
    expect(await readFile(join(first, name), "utf8")).toBe(name);
  await writeFile(files["launch.json"], "again");
  const second = await retireEndpoint(root, "amun-pi", files);
  expect(second).not.toBe(first);
  expect(await readFile(join(second, "launch.json"), "utf8")).toBe("again");
});
