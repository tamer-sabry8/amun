import { it, expect } from "vitest";
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  stat,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listReceiptTasks,
  saveEndpointReceipt,
  loadEndpointReceipt,
} from "../src/endpoint-receipt.ts";
const receipt = {
  version: 1,
  backend: "tmux",
  home: "/private/tmp/home",
  scope: "/private/tmp/amun-tmux-test",
  socket: "/private/tmp/amun-tmux-test/tmux-501/default",
  identity: {
    taskId: "proof-1",
    window: "firstmate:fm-proof-1",
    worktree: "/private/tmp/work",
    spawnGeneration: "a.1",
    paneId: "%1",
    windowId: "@1",
    serverPid: 123,
    panePid: 456,
    ownerToken: "a".repeat(32),
  },
};
it("persists a private exclusive receipt and reloads the exact identity", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-receipt-")));
  try {
    await saveEndpointReceipt(root, receipt);
    expect(await loadEndpointReceipt(root, "proof-1")).toEqual(receipt);
    expect((await stat(join(root, "proof-1.json"))).mode & 0o777).toBe(0o600);
    await expect(saveEndpointReceipt(root, receipt)).rejects.toThrow();
    expect(
      JSON.parse(await readFile(join(root, "proof-1.json"), "utf8")),
    ).toEqual(receipt);
    await chmod(root, 0o755);
    await expect(loadEndpointReceipt(root, "proof-1")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects traversal, unsafe identifiers, extra fields and symlink receipts", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-receipt-")));
  try {
    for (const bad of [
      { ...receipt, extra: true },
      { ...receipt, socket: "/another/socket" },
      { ...receipt, identity: { ...receipt.identity, taskId: "../escape" } },
      { ...receipt, identity: { ...receipt.identity, paneId: "firstmate" } },
    ])
      await expect(saveEndpointReceipt(root, bad)).rejects.toThrow();
    await saveEndpointReceipt(root, receipt);
    await symlink(join(root, "proof-1.json"), join(root, "redirect.json"));
    await expect(loadEndpointReceipt(root, "redirect")).rejects.toThrow();
    await expect(loadEndpointReceipt(root, "../proof-1")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("lists only validated owned task IDs in a private receipt directory", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-receipt-list-")),
  );
  try {
    await saveEndpointReceipt(root, receipt);
    await symlink(join(root, "proof-1.json"), join(root, "other.json"));
    expect(await listReceiptTasks(root)).toEqual(["proof-1"]);
    await chmod(root, 0o755);
    await expect(listReceiptTasks(root)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
