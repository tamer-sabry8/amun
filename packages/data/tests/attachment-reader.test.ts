import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachmentTextLimit,
  readAttachment,
} from "../src/attachment-reader.ts";

/** Builds a real Office package from its parts with the system zip. */
function pack(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "amun-pack-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  execFileSync("/usr/bin/zip", ["-q", "-r", "out.zip", "."], { cwd: dir });
  return readFileSync(join(dir, "out.zip"));
}
const mac = process.platform === "darwin";

describe("composer attachments", () => {
  it("reads text, Markdown and CSV whole", async () => {
    const csv = await readAttachment(
      "testers.csv",
      Buffer.from("name,city\nAmal,Dubai\n"),
    );
    expect(csv).toMatchObject({
      format: "CSV",
      read: "all",
      note: null,
      text: "name,city\nAmal,Dubai",
    });
  });

  it("reads past the limit and says exactly what was left out", async () => {
    const big = await readAttachment(
      "log.txt",
      Buffer.from("x".repeat(attachmentTextLimit * 4)),
    );
    expect(big.read).toBe("part");
    expect(big.text).toHaveLength(attachmentTextLimit);
    expect(big.note).toBe(
      "Read the first 100,000 of 400,000 characters (about 25%). Ask about a section or page range to read further in.",
    );
  });

  it("tries an unknown format as text and explains a binary one", async () => {
    const yaml = await readAttachment("deploy.yaml", Buffer.from("env: stg"));
    expect(yaml).toMatchObject({ format: "YAML", read: "all" });
    const binary = await readAttachment(
      "model.bin",
      Buffer.from([0, 1, 2, 255, 254, 0, 9]),
    );
    expect(binary.read).toBe("none");
    expect(binary.note).toContain("could not read this BIN file");
    expect((await readAttachment("empty.md", Buffer.alloc(0))).note).toBe(
      "This file is empty.",
    );
  });

  it.runIf(mac)("reads Excel sheets as rows", async () => {
    const book = pack({
      "xl/sharedStrings.xml":
        "<sst><si><t>City</t></si><si><t>Dubai &amp; Sharjah</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>10</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>50</v></c></row></sheetData></worksheet>',
    });
    const read = await readAttachment("pilot.xlsx", book);
    expect(read).toMatchObject({ format: "Excel", read: "all" });
    expect(read.text).toBe("# Sheet 1\nCity\t10\nDubai & Sharjah\t50");
  });

  it.runIf(mac)("reads PowerPoint slides in order", async () => {
    const deck = pack({
      "ppt/slides/slide2.xml":
        "<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide1.xml":
        "<p:sld><a:p><a:r><a:t>Pilot </a:t></a:r><a:r><a:t>plan</a:t></a:r></a:p></p:sld>",
    });
    const read = await readAttachment("deck.pptx", deck);
    expect(read.text).toBe("# Slide 1\nPilot plan\n# Slide 2\nSecond");
  });

  it("rejects an Office file whose contents are something else", async () => {
    const fake = await readAttachment("pilot.xlsx", Buffer.from("not a zip"));
    expect(fake).toMatchObject({
      read: "none",
      note: "This is not a valid Excel file.",
    });
  });
});
