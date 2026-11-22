import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

// A crew report names the documents it wrote by path ("PRD v0.1 DRAFT saved:
// /…/prd-v0.1.md and prd-v0.1.docx"). Amun reads only Markdown files inside
// that crew member's own home, for a report already matched to its request;
// the file is data, never instructions (stories, backlogs and sprints brief:
// a PRD on the Mac is a source version, "Source kept in Amun").

const maxBytes = 512 * 1024;

/** Absolute Markdown paths a report names, in order and without repeats. */
export function reportedMarkdownPaths(text: string): string[] {
  const found = text.match(/\/[^\s"'`<>()]+?\.md(?=$|[\s"'`<>(),;:]|\.(?:\s|$))/g) ?? [];
  return [...new Set(found)].slice(0, 8);
}

export interface CrewHomeInput {
  fmHome: string;
  taskId: string;
}

/** The home a registered crew member works in, from Firstmate's own record. */
export async function crewHome({ fmHome, taskId }: CrewHomeInput): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(taskId)) return null;
  const meta = await readFile(path.join(fmHome, "state", `${taskId}.meta`), "utf8").catch(() => "");
  const home = /^home=(.+)$/m.exec(meta)?.[1]?.trim();
  return home && path.isAbsolute(home) ? home : null;
}

export interface CrewDocument {
  path: string;
  title: string;
  markdown: string;
  kind: "prd" | "brd" | "doc";
}

export interface CrewDocumentInput {
  file: string;
  home: string;
}

/**
 * Reads one reported file when it is a Markdown file inside the crew home.
 * Anything else (outside the home, not Markdown, unreadable, too large) is
 * skipped: the report still reaches the captain through Firstmate.
 */
export async function readCrewDocument({
  file,
  home,
}: CrewDocumentInput): Promise<CrewDocument | null> {
  try {
    const [realHome, realFile] = await Promise.all([realpath(home), realpath(file)]);
    if (!realFile.startsWith(realHome + path.sep) || path.extname(realFile).toLowerCase() !== ".md") return null;
    const stat = await lstat(realFile);
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) return null;
    const markdown = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(realFile)).trim();
    if (!markdown) return null;
    const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
    const name = path.basename(realFile, path.extname(realFile));
    return {
      path: realFile,
      title: (heading || name).slice(0, 200),
      markdown,
      kind: documentKind(name, heading ?? ""),
    };
  } catch {
    return null;
  }
}

export function documentKind(name: string, heading: string): CrewDocument["kind"] {
  if (/(^|[-_ ])prd([-_ .]|$)/i.test(name) || /product requirements document/i.test(heading)) return "prd";
  if (/(^|[-_ ])brd([-_ .]|$)/i.test(name) || /business requirements document/i.test(heading)) return "brd";
  return "doc";
}
