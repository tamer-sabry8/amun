import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveEndpointReceipt } from "../src/endpoint-receipt.ts";
import {
  captureOwnedTmux,
  sessionBytes,
  sessionLines,
  shapeSessionText,
} from "../src/capture-owned-tmux.ts";

let root: string;
let receipts: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "amun-capture-")));
  receipts = join(root, "receipts");
  const scope = join(root, "scope");
  await mkdir(receipts, { mode: 0o700 });
  await mkdir(join(scope, "tmux-501"), { recursive: true });
  await saveEndpointReceipt(receipts, {
    version: 1,
    backend: "tmux",
    home: join(root, "home"),
    scope,
    socket: join(scope, "tmux-501", "default"),
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

const verified = async () => ({
  endpoint: "verified" as const,
  worker: "unknown" as const,
});
const redact = (text: string) => text.replaceAll("hunter2", "[redacted]");

it("captures only the receipt's own pane, redacted and bounded", async () => {
  const run = vi.fn(async () => "\u001b[31mtoken hunter2\u001b[0m\nok\n\n");
  const text = await captureOwnedTmux(
    receipts,
    "amun-pi",
    "/usr/bin/tmux",
    redact,
    {
      observe: verified,
      run,
    },
  );
  expect(text).toBe("token [redacted]\nok");
  expect(run).toHaveBeenCalledWith([
    "-S",
    join(root, "scope", "tmux-501", "default"),
    "capture-pane",
    "-p",
    "-J",
    "-S",
    "-" + sessionLines,
    "-t",
    "%2",
  ]);
});

it("refuses arbitrary targets, unrecorded tasks and unverified panes", async () => {
  const run = vi.fn(async () => "secret");
  for (const id of ["../etc", "main:0", "%1", "other-task", ""])
    expect(
      await captureOwnedTmux(receipts, id, "/usr/bin/tmux", redact, {
        observe: verified,
        run,
      }),
    ).toBeNull();
  expect(
    await captureOwnedTmux(receipts, "amun-pi", "/usr/bin/tmux", redact, {
      observe: async () => ({ endpoint: "unknown", worker: "unknown" }),
      run,
    }),
  ).toBeNull();
  expect(
    await captureOwnedTmux(receipts, "amun-pi", "tmux", redact, {
      observe: verified,
      run,
    }),
  ).toBeNull();
  expect(run).not.toHaveBeenCalled();
});

it("keeps the last lines and the size bound", () => {
  const many = Array.from({ length: 500 }, (_, i) => "line " + i).join("\n");
  const lines = shapeSessionText(many, (t) => t).split("\n");
  expect(lines).toHaveLength(sessionLines);
  expect(lines.at(-1)).toBe("line 499");
  expect(shapeSessionText("x".repeat(100000), (t) => t)).toHaveLength(
    sessionBytes,
  );
});
