import { writeFileSync } from "node:fs";
import { it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NativePiExport } from "../src/native-pi-export.ts";
it("uses owned temporary output and returns a bounded review document, never a renderer-supplied path", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-export-test-")),
  );
  const session = {
    isStreaming: false,
    exportToHtml: vi.fn(async (path: string) => {
      await writeFile(path, "<html>review</html>");
      return path;
    }),
    exportToJsonl: vi.fn((path: string) => {
      writeFileSync(path, "readable transcript");
      return path;
    }),
  };
  try {
    const exporter = new NativePiExport(session, root);
    expect(await exporter.run("html")).toEqual({
      kind: "export",
      format: "html",
      text: "<html>review</html>",
      review: "readable transcript",
    });
    expect(session.exportToHtml.mock.calls[0]![0]).toMatch(
      new RegExp("^" + root + "/"),
    );
    await expect(exporter.run("/personal/file")).rejects.toThrow();
    session.isStreaming = true;
    await expect(exporter.run("html")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses a runtime's foreign or oversized export without returning document content", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-export-test-")),
  );
  const session = {
    isStreaming: false,
    exportToHtml: vi.fn(async (path: string) => path.replace(/.*/, "/foreign")),
    exportToJsonl: vi.fn((path: string) => {
      writeFileSync(path, "readable transcript");
      return path;
    }),
  };
  try {
    const exporter = new NativePiExport(session, root);
    await expect(exporter.run("html")).rejects.toThrow();
    session.exportToHtml = vi.fn(async (path: string) => {
      await writeFile(path, "x".repeat(524289));
      return path;
    });
    await expect(exporter.run("html")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
