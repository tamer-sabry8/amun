// Reads a composer attachment into text Firstmate can use (handoff journey 6).
// Every file is tried: known formats through the readers below, anything
// else as text. Nothing is rejected for size alone; when only part of a file
// can be passed on, the note says exactly how much was read.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { extractDocument } from "./document-import.ts";

export interface Attachment {
  name: string;
  /** Format label shown to the user, e.g. "PDF". */
  format: string;
  /** Text handed to Firstmate; empty when nothing could be read. */
  text: string;
  /** The image itself, for formats a model can look at. */
  image: Buffer | null;
  /** Plain explanation of a limit or an unread portion; null when whole. */
  note: string | null;
  read: "all" | "part" | "none";
  /** Share of the text that was read, 0–1; null unless only part was. */
  portion: number | null;
}
/** Characters of one attachment passed to Firstmate in a single message. */
export const attachmentTextLimit = 100_000;
const sizeText = (bytes: number) =>
  bytes < 1024 * 1024
    ? Math.max(1, Math.round(bytes / 1024)) + " KB"
    : (bytes / 1024 / 1024).toFixed(1) + " MB";
const labels: Record<string, string> = {
  txt: "Text",
  md: "Markdown",
  csv: "CSV",
  tsv: "TSV",
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  pptx: "PowerPoint",
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
};
const entities = (value: string) =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

async function withFile<T>(
  bytes: Buffer,
  extension: string,
  use: (
    path: string,
    run: (file: string, args: string[]) => Promise<string>,
  ) => Promise<T>,
) {
  const dir = await mkdtemp(join(tmpdir(), "amun-attachment-"));
  const path = join(dir, "input." + extension);
  const run = async (file: string, args: string[]) =>
    (
      await promisify(execFile)(file, args, {
        cwd: dir,
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { HOME: dir, TMPDIR: dir, PATH: "/usr/bin:/bin" },
      })
    ).stdout;
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    return await use(path, run);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const zip = Buffer.from([80, 75, 3, 4]);
/** Names inside an Office package, in document order. */
async function entries(
  path: string,
  run: (file: string, args: string[]) => Promise<string>,
  pattern: RegExp,
) {
  const names = (await run("/usr/bin/unzip", ["-Z1", path]))
    .split("\n")
    .filter((name) => pattern.test(name));
  const number = (name: string) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  return names.sort((a, b) => number(a) - number(b));
}
async function excel(bytes: Buffer) {
  return withFile(bytes, "xlsx", async (path, run) => {
    const part = (name: string) =>
      run("/usr/bin/unzip", ["-p", path, name]).catch(() => "");
    const shared = [
      ...(await part("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g),
    ].map((match) =>
      entities(
        [...match[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((text) => text[1])
          .join(""),
      ),
    );
    const sheets = await entries(path, run, /^xl\/worksheets\/sheet\d+\.xml$/);
    if (!sheets.length) throw Error("No worksheets");
    const out: string[] = [];
    for (const [index, name] of sheets.entries()) {
      out.push(`# Sheet ${index + 1}`);
      for (const row of (await part(name)).matchAll(
        /<row[^>]*>([\s\S]*?)<\/row>/g,
      )) {
        const cells = [
          ...row[1]!.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g),
        ].map((cell) => {
          const body = cell[2] ?? "";
          const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          if (/t="s"/.test(cell[1]!)) return shared[Number(value)] ?? "";
          if (/t="inlineStr"/.test(cell[1]!))
            return entities(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "");
          return entities(value ?? "");
        });
        if (cells.some((cell) => cell)) out.push(cells.join("\t"));
      }
    }
    return out.join("\n");
  });
}
async function powerpoint(bytes: Buffer) {
  return withFile(bytes, "pptx", async (path, run) => {
    const slides = await entries(path, run, /^ppt\/slides\/slide\d+\.xml$/);
    if (!slides.length) throw Error("No slides");
    const out: string[] = [];
    for (const [index, name] of slides.entries()) {
      const xml = await run("/usr/bin/unzip", ["-p", path, name]);
      const lines = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
        .map((paragraph) =>
          entities(
            [...paragraph[1]!.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
              .map((text) => text[1])
              .join(""),
          ).trim(),
        )
        .filter(Boolean);
      out.push(`# Slide ${index + 1}`, ...lines);
    }
    return out.join("\n");
  });
}

/** Trims text to what one message can carry and says what was left out. */
function fit(
  text: string,
): Pick<Attachment, "text" | "note" | "read" | "portion"> {
  const clean = text.replaceAll("\0", "").trim();
  if (!clean)
    return {
      text: "",
      read: "none",
      portion: null,
      note: "No readable text was found in this file.",
    };
  if (clean.length <= attachmentTextLimit)
    return { text: clean, read: "all", note: null, portion: null };
  const percent = Math.floor((attachmentTextLimit / clean.length) * 100);
  return {
    text: clean.slice(0, attachmentTextLimit),
    read: "part",
    portion: attachmentTextLimit / clean.length,
    note: `Read the first ${attachmentTextLimit.toLocaleString("en")} of ${clean.length.toLocaleString("en")} characters (about ${percent}%). Ask about a section or page range to read further in.`,
  };
}

export async function readAttachment(
  name: string,
  bytes: Buffer,
): Promise<Attachment> {
  const kind = extname(name).slice(1).toLowerCase();
  const format = labels[kind] ?? (kind ? kind.toUpperCase() : "File");
  const base = { name, format, image: null };
  const unread = (note: string): Attachment => ({
    ...base,
    text: "",
    read: "none",
    portion: null,
    note,
  });
  if (!bytes.length) return unread("This file is empty.");
  try {
    if (kind === "png" || kind === "jpg" || kind === "jpeg") {
      const image = await extractDocument(name, bytes);
      return {
        ...base,
        text: image.body,
        image: image.image,
        read: "all",
        portion: null,
        note: null,
      };
    }
    if (kind === "xlsx" || kind === "pptx") {
      if (!bytes.subarray(0, 4).equals(zip))
        return unread(`This is not a valid ${format} file.`);
      return {
        ...base,
        ...fit(await (kind === "xlsx" ? excel(bytes) : powerpoint(bytes))),
      };
    }
    if (kind === "pdf" || kind === "docx") {
      // The existing reader holds 8 MiB and 200,000 characters.
      if (bytes.length <= 8 * 1024 * 1024)
        try {
          return { ...base, ...fit((await extractDocument(name, bytes)).body) };
        } catch {
          // Fall through to the lenient reader below.
        }
      const text = await withFile(bytes, kind, (path, run) =>
        kind === "docx"
          ? run("/usr/bin/textutil", [
              "-format",
              "docx",
              "-convert",
              "txt",
              "-encoding",
              "UTF-8",
              "-stdout",
              path,
            ])
          : run("/usr/bin/osascript", [
              "-l",
              "JavaScript",
              "-e",
              `ObjC.import("PDFKit");function run(a){const p=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0]));if(!p||p.isLocked)throw Error("locked");return ObjC.unwrap(p.string)||""}`,
              path,
            ]),
      );
      const result = fit(text);
      return result.read === "none" && kind === "pdf"
        ? unread(
            "This PDF has no text layer (it may be scanned). Attach it as images or paste the text.",
          )
        : { ...base, ...result };
    }
    // Everything else is tried as text.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\0-\x08\x0e-\x1f]/.test(text.slice(0, 4096))) throw Error("binary");
    return { ...base, ...fit(text) };
  } catch {
    return unread(
      `Amun could not read this ${format} file (${sizeText(bytes.length)}). It is kept in the library; try exporting it as PDF or text.`,
    );
  }
}
