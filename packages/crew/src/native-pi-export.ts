import { mkdtemp, open, rm, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
export interface ExportSession {
  isStreaming: boolean;
  exportToHtml(path: string): Promise<string>;
  exportToJsonl(path: string): string;
}
export class NativePiExport {
  constructor(
    private session: ExportSession,
    private root: string,
  ) {}
  async run(format: string): Promise<{
    kind: "export";
    format: "html" | "jsonl";
    text: string;
    review: string;
  }> {
    if ((format !== "html" && format !== "jsonl") || this.session.isStreaming)
      throw Error("Invalid export request or busy session");
    const rootStat = await lstat(this.root);
    if (
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      (rootStat.mode & 0o077) !== 0 ||
      rootStat.uid !== process.getuid?.() ||
      (await realpath(this.root)) !== this.root
    )
      throw Error("Unsafe export directory");
    const temporary = await mkdtemp(join(this.root, "export-"));
    try {
      const path = join(temporary, "session." + format);
      const output =
        format === "html"
          ? await this.session.exportToHtml(path)
          : this.session.exportToJsonl(path);
      if (output !== path) throw Error("Unexpected export path");
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.uid !== process.getuid?.() ||
          stat.size > 524288
        )
          throw Error("Export exceeds review limit");
        const text = await handle.readFile("utf8");
        if (Buffer.byteLength(text) > 524288)
          throw Error("Export exceeds review limit");
        let review = text;
        if (format === "html") {
          const reviewPath = join(temporary, "review.jsonl");
          if (this.session.exportToJsonl(reviewPath) !== reviewPath)
            throw Error("Unexpected review path");
          const reviewHandle = await open(
            reviewPath,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          try {
            const reviewStat = await reviewHandle.stat();
            if (
              !reviewStat.isFile() ||
              reviewStat.nlink !== 1 ||
              reviewStat.size > 524288
            )
              throw Error("Review exceeds limit");
            review = await reviewHandle.readFile("utf8");
            if (Buffer.byteLength(review) > 524288)
              throw Error("Review exceeds limit");
          } finally {
            await reviewHandle.close();
          }
        }
        return { kind: "export", format, text, review };
      } finally {
        await handle.close();
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
