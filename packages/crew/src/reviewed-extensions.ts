import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  lstat,
  realpath,
  readdir,
  writeFile,
  rename,
  rm,
  link,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedPrivateFile } from "./endpoint-receipt.ts";
const hash = (source: string) =>
  createHash("sha256").update(source).digest("hex");
export class ReviewedExtensions {
  private pending:
    | {
        id: string;
        source: string;
        name: string;
        digest: string;
        ext: string;
      }
    | undefined;
  private constructor(
    private store: string,
    private stage: string,
  ) {}
  static async open(root: string) {
    const store = join(root, "reviewed-extensions");
    await mkdir(store, { recursive: true, mode: 0o700 });
    const stat = await lstat(store);
    if (
      (await realpath(store)) !== store ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw Error("Unsafe extension directory");
    const stage = await realpath(
      await mkdtemp(join(tmpdir(), "amun-reviewed-pi-")),
    );
    return new ReviewedExtensions(store, stage);
  }
  get entry() {
    return join(this.stage, "index.ts");
  }
  review(name: string, source: string) {
    if (
      !/^[\w .-]{1,180}\.(?:js|ts)$/.test(name) ||
      !source.trim() ||
      source.includes("\0") ||
      Buffer.byteLength(source) > 65536
    )
      throw Error("Expected bounded JavaScript or TypeScript source");
    const id = randomUUID(),
      digest = hash(source);
    this.pending = {
      name,
      source,
      id,
      digest,
      ext: name.endsWith(".ts") ? "ts" : "js",
    };
    return { kind: "extension-review" as const, id, name, source, digest };
  }
  async trust(id: string) {
    const p = this.pending;
    if (!p || p.id !== id) throw Error("Extension review expired");
    this.pending = undefined;
    const file = join(this.store, p.digest + "." + p.ext),
      stage = join(this.store, "." + randomUUID() + ".pending");
    if ((await this.files()).length >= 16)
      throw Error("Extension limit reached");
    try {
      await writeFile(stage, p.source, {
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
      try {
        await link(stage, file);
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await readBoundedPrivateFile(file, 65536)) !== p.source
        )
          throw e;
      }
    } finally {
      await rm(stage, { force: true });
    }
    await this.refresh();
  }
  private async files() {
    const files = (await readdir(this.store))
      .filter((f) => /^[0-9a-f]{64}\.(js|ts)$/.test(f))
      .sort();
    if (files.length > 16) throw Error("Extension limit exceeded");
    return files;
  }
  async refresh() {
    const files = await this.files();
    const imports: string[] = [];
    for (const [i, f] of files.entries()) {
      const source = await readBoundedPrivateFile(join(this.store, f), 65536);
      if (hash(source) !== f.slice(0, 64))
        throw Error("Reviewed extension changed");
      const dest = join(this.stage, f);
      try {
        await writeFile(dest, source, { flag: "wx", mode: 0o600 });
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await readBoundedPrivateFile(dest, 65536)) !== source
        )
          throw e;
      }
      imports.push("import extension" + i + ' from "./' + f + '";');
    }
    const next = this.entry + "." + randomUUID();
    await writeFile(
      next,
      [
        ...imports,
        "export default async function(pi){",
        ...files.map((_, i) => "await extension" + i + "(pi);"),
        "}",
      ].join("\n"),
      { flag: "wx", mode: 0o600 },
    );
    await rename(next, this.entry);
  }
  async remove(digest: string) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw Error("Invalid extension");
    for (const ext of ["js", "ts"])
      await rm(join(this.store, digest + "." + ext), { force: true });
    await this.refresh();
  }
  async installed() {
    return (await this.files()).map((f) => f.slice(0, 64));
  }
  async close() {
    await rm(this.stage, { recursive: true, force: true });
  }
}
