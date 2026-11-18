import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";

export class DocumentInputError extends Error {}
const formats = ["txt", "md", "pdf", "docx", "png", "jpeg", "jpg"];
const pdfReader = `ObjC.import("PDFKit");function run(args){
  const pdf=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(args[0]));
  if(!pdf || pdf.isLocked || pdf.pageCount>500) throw Error("unreadable PDF");
  return ObjC.unwrap(pdf.string) || "";
}`;
export async function extractDocument(name: string, bytes: Buffer) {
  const kind = extname(name).slice(1).toLowerCase();
  if (!formats.includes(kind))
    throw new DocumentInputError(
      "Choose TXT, Markdown, text PDF, DOCX, PNG or JPEG.",
    );
  if (!bytes.length || bytes.length > 8 * 1024 * 1024)
    throw new DocumentInputError("Choose a nonempty file up to 8 MiB.");
  if (kind === "txt" || kind === "md") {
    let body: string;
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new DocumentInputError("Save the text as UTF-8 and try again.");
    }
    validateText(body);
    return { kind, body, image: null };
  }
  const signature: Record<string, Buffer> = {
    pdf: Buffer.from("%PDF-"),
    docx: Buffer.from([80, 75, 3, 4]),
    png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    jpeg: Buffer.from([255, 216, 255]),
  };
  const format = kind === "jpg" ? "jpeg" : kind;
  const prefix = signature[format]!;
  if (!bytes.subarray(0, prefix.length).equals(prefix))
    throw new DocumentInputError(
      "The contents do not match the selected file format.",
    );
  const dir = await mkdtemp(join(tmpdir(), "amun-document-"));
  const path = join(dir, "input." + format);
  const run = async (file: string, args: string[]) =>
    (
      await promisify(execFile)(file, args, {
        cwd: dir,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { HOME: dir, TMPDIR: dir, PATH: "/usr/bin:/bin" },
      })
    ).stdout;
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    if (format === "png" || format === "jpeg") {
      const info = await run("/usr/bin/sips", [
        "-g",
        "format",
        "-g",
        "pixelWidth",
        "-g",
        "pixelHeight",
        path,
      ]);
      const width = Number(/pixelWidth: (\d+)/.exec(info)?.[1]),
        height = Number(/pixelHeight: (\d+)/.exec(info)?.[1]);
      if (
        !info.includes("format: " + format) ||
        !(width * height > 0 && width * height <= 40_000_000)
      )
        throw Error("Invalid image");
      return {
        kind: format,
        body: `${format.toUpperCase()} image, ${width} × ${height} pixels`,
        image: bytes,
      };
    }
    let body: string;
    if (format === "docx") {
      const listing = await run("/usr/bin/unzip", ["-l", path]);
      const sum = /\n\s*(\d+)\s+\d+ files?\s*$/.exec(listing);
      if (
        !sum ||
        Number(sum[1]) > 16 * 1024 * 1024 ||
        !listing.includes(" word/document.xml")
      )
        throw Error("Invalid document package");
      body = await run("/usr/bin/textutil", [
        "-format",
        "docx",
        "-convert",
        "txt",
        "-encoding",
        "UTF-8",
        "-stdout",
        path,
      ]);
    } else
      body = await run("/usr/bin/osascript", [
        "-l",
        "JavaScript",
        "-e",
        pdfReader,
        path,
      ]);
    body = body.trim();
    validateText(body);
    return { kind, body, image: null };
  } catch (e) {
    if (e instanceof DocumentInputError) throw e;
    throw new DocumentInputError(
      "Amun could not read this file. Use an unlocked text PDF, valid DOCX, PNG or JPEG.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function validateText(body: string) {
  if (!body.trim() || body.length > 200_000 || body.includes("\0"))
    throw new DocumentInputError(
      "Choose a document with readable text, up to 200,000 characters.",
    );
}
