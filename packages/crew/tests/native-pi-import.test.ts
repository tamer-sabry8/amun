import { it, expect, vi } from "vitest";
import { mkdtemp, readFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativePiImport } from "../src/native-pi-import.ts";
const header = {
  type: "session",
  version: 3,
  id: "11111111-1111-4111-8111-111111111111",
  timestamp: "2026-11-06T00:00:00Z",
  cwd: "/original/work",
  parentSession: "/personal/session.jsonl",
};
const text =
  JSON.stringify(header) +
  "\n" +
  JSON.stringify({
    type: "session_info",
    id: "abcd1234",
    parentId: null,
    timestamp: header.timestamp,
    name: "Imported acceptance",
  }) +
  "\n";
it("reviews before importing, keeps the ID and isolates cwd without touching source paths", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-import-")));
  const imported = vi.fn(async (path: string, cwd: string) => {
    const record = JSON.parse((await readFile(path, "utf8")).split("\n")[0]!);
    expect(record).toMatchObject({ id: header.id, cwd: root });
    expect(record.parentSession).toBeUndefined();
    expect(cwd).toBe(root);
    return { cancelled: false };
  });
  try {
    const adapter = new NativePiImport(
      { session: { isStreaming: false }, importFromJsonl: imported },
      root,
      async () => [],
    );
    const review = adapter.preview(text);
    expect(imported).not.toHaveBeenCalled();
    expect(review.originalCwd).toBe(header.cwd);
    await adapter.confirm(review.token);
    expect(imported).toHaveBeenCalledTimes(1);
    await expect(adapter.confirm(review.token)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects malformed, oversized, duplicate and unreviewed imports", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-import-")));
  const imported = vi.fn(async () => ({ cancelled: false }));
  try {
    const adapter = new NativePiImport(
      { session: { isStreaming: false }, importFromJsonl: imported },
      root,
      async () => [header.id],
    );
    for (const invalid of [
      "not json",
      "a".repeat(524289),
      JSON.stringify({ ...header, version: 99 }),
      JSON.stringify({ ...header, id: "../../outside" }),
    ])
      expect(() => adapter.preview(invalid)).toThrow();
    await expect(adapter.confirm("unknown")).rejects.toThrow();
    const review = adapter.preview(text);
    await expect(adapter.confirm(review.token)).rejects.toThrow("already");
    expect(imported).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses expired reviews, busy sessions and malformed entry trees", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-import-")));
  const imported = vi.fn(async () => ({ cancelled: false }));
  const runtime = {
    session: { isStreaming: false },
    importFromJsonl: imported,
  };
  try {
    const adapter = new NativePiImport(runtime, root, async () => []);
    const review = adapter.preview(text);
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 700000);
    await expect(adapter.confirm(review.token)).rejects.toThrow();
    now.mockRestore();
    runtime.session.isStreaming = true;
    expect(() => adapter.preview(text)).toThrow();
    runtime.session.isStreaming = false;
    expect(() => adapter.preview(text + text.split("\n")[1] + "\n")).toThrow();
    expect(() =>
      adapter.preview(text.replace('"parentId":null', '"parentId":"missing"')),
    ).toThrow();
    expect(imported).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
