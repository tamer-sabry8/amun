import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  crewHome,
  documentKind,
  readCrewDocument,
  reportedMarkdownPaths,
} from "./crew-documents.js";

describe("reportedMarkdownPaths", () => {
  it("reads the Markdown paths from PRD reports seen on 22 November 2026", () => {
    expect(
      reportedMarkdownPaths(
        "amun-r-f8e2e9ff68e2 Sales Prospects PRD v0.1 DRAFT saved: /Users/t/.treehouse/fm/5/firstmate/data/prds/sales-prospects/prd-v0.1.md and prd-v0.1.docx. Headline: vision = …",
      ),
    ).toEqual(["/Users/t/.treehouse/fm/5/firstmate/data/prds/sales-prospects/prd-v0.1.md"]);
    expect(
      reportedMarkdownPaths(
        "Invoiced BRD v0.1 DRAFT saved: /h/data/brds/invoiced/brd-v0.1.md and brd-v0.1.docx; epics at /h/data/brds/invoiced/epics-stories-linear-v0.1.md plus CSV (same folder). Also /h/data/brds/invoiced/brd-v0.1.md.",
      ),
    ).toEqual(["/h/data/brds/invoiced/brd-v0.1.md", "/h/data/brds/invoiced/epics-stories-linear-v0.1.md"]);
  });
});

describe("reportedMarkdownPaths with a sibling named alone", () => {
  it("reads the Markdown named after a full .docx path (Badge Desk, 22 November 2026)", () => {
    expect(
      reportedMarkdownPaths(
        "amun-r-05e8b1651352 Badge Desk short PRD v0.1 DRAFT ready: /Users/t/.treehouse/fm/5/firstmate/data/prds/badge-desk/prd-v0.1.docx and prd-v0.1.md. Summary: reasoned from the one-line description",
      ),
    ).toEqual(["/Users/t/.treehouse/fm/5/firstmate/data/prds/badge-desk/prd-v0.1.md"]);
  });
  it("ignores a bare name with no full path before it", () => {
    expect(reportedMarkdownPaths("Wrote prd-v0.1.md somewhere.")).toEqual([]);
  });
});

describe("documentKind", () => {
  it("tells a PRD and a BRD from other documents", () => {
    expect(documentKind("prd-v0.1", "Sales Prospects - Product Requirements Document")).toBe("prd");
    expect(documentKind("brd-v0.1", "")).toBe("brd");
    expect(documentKind("notes", "Invoiced - Business Requirements Document (BRD)")).toBe("brd");
    expect(documentKind("epics-stories-v0.1", "Epics and stories")).toBe("doc");
    expect(documentKind("prdx", "")).toBe("doc");
  });
});

describe("crew files", () => {
  let root: string;
  let home: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "amun-crew-"));
    home = path.join(root, "crew");
    await mkdir(path.join(home, "data"), { recursive: true });
    await mkdir(path.join(root, "fm", "state"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds the crew home from Firstmate's own record", async () => {
    await writeFile(path.join(root, "fm", "state", "prd.meta"), `window=x\nhome=${home}\nmodel=y\n`);
    await expect(crewHome({ fmHome: path.join(root, "fm"), taskId: "prd" })).resolves.toBe(home);
    await expect(crewHome({ fmHome: path.join(root, "fm"), taskId: "../prd" })).resolves.toBeNull();
    await expect(crewHome({ fmHome: path.join(root, "fm"), taskId: "designer" })).resolves.toBeNull();
  });

  it("reads a Markdown file inside the crew home, titled by its heading", async () => {
    const file = path.join(home, "data", "prd-v0.1.md");
    await writeFile(file, "# Sales Prospects - Product Requirements Document\n\nBody ``` with fences\n");
    await expect(readCrewDocument({ file, home })).resolves.toMatchObject({
      title: "Sales Prospects - Product Requirements Document",
      kind: "prd",
      markdown: "# Sales Prospects - Product Requirements Document\n\nBody ``` with fences",
    });
  });

  it("refuses files outside the home, escapes through links, and other types", async () => {
    const outside = path.join(root, "secret.md");
    await writeFile(outside, "# Not the crew's\n");
    await expect(readCrewDocument({ file: outside, home })).resolves.toBeNull();
    const link = path.join(home, "data", "link.md");
    await symlink(outside, link);
    await expect(readCrewDocument({ file: link, home })).resolves.toBeNull();
    const sneaky = path.join(home, "data", "..", "..", "secret.md");
    await expect(readCrewDocument({ file: sneaky, home })).resolves.toBeNull();
    const text = path.join(home, "data", "notes.txt");
    await writeFile(text, "# Text\n");
    await expect(readCrewDocument({ file: text, home })).resolves.toBeNull();
    const empty = path.join(home, "data", "empty.md");
    await writeFile(empty, "");
    await expect(readCrewDocument({ file: empty, home })).resolves.toBeNull();
  });
});
