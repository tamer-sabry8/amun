import { execFile } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  productSpaceSchema,
  type PrimaryHarness,
  type ProductSpace,
  type RuntimeBackend,
} from "@getpaseo/protocol/amun-rpc";
import type { AmunPaths } from "./amun-paths.js";

const run = promisify(execFile);

// Git's well-known empty tree; lets the homes repo get a root commit without a checkout.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Amun",
  GIT_AUTHOR_EMAIL: "amun@localhost",
  GIT_COMMITTER_NAME: "Amun",
  GIT_COMMITTER_EMAIL: "amun@localhost",
};
const SPACE_FILE = "amun-space.json";

/** The Firstmate operational layout (AGENTS.md section 2). */
export const FM_HOME_DIRS = ["state", "data", "config", "projects"] as const;

export const EMPTY_BACKLOG = "# Backlog\n\n## In flight\n\n## Queued\n\n## Done\n";

export class ProductSpaceExistsError extends Error {
  constructor(public readonly slug: string) {
    super(`Product Space "${slug}" already exists`);
    this.name = "ProductSpaceExistsError";
  }
}

export class ProductSpaceNotFoundError extends Error {
  constructor(public readonly slug: string) {
    super(`Product Space "${slug}" does not exist`);
    this.name = "ProductSpaceNotFoundError";
  }
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "space";
}

export function findOnPath(binary: string, pathValue: string = process.env.PATH ?? ""): string | null {
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

/** docs/configuration.md: hc resolves `herdr-core`, then the `hc` alias. Default tmux. */
export function detectRuntimeBackend(pathValue?: string): RuntimeBackend {
  return findOnPath("herdr-core", pathValue) || findOnPath("hc", pathValue) ? "hc" : "tmux";
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    env: { ...process.env, ...GIT_IDENTITY },
  });
  return stdout.trim();
}

export interface CreateSpaceInput {
  name: string;
  slug?: string;
  harness?: PrimaryHarness;
  backend?: RuntimeBackend;
}

/**
 * Product Spaces are Firstmate homes ($FM_HOME). Each home is a real Git worktree
 * of an Amun-owned bare repository (owner rule in AGENTS.md, 2026-11-06).
 */
export class ProductSpaceStore {
  constructor(
    private readonly paths: AmunPaths,
    private readonly now: () => Date = () => new Date(),
  ) {}

  homeFor(slug: string): string {
    return path.join(this.paths.homesRoot, slug);
  }

  async list(): Promise<ProductSpace[]> {
    if (!existsSync(this.paths.homesRoot)) return [];
    const entries = await readdir(this.paths.homesRoot, { withFileTypes: true });
    const spaces: ProductSpace[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.paths.homesRoot, entry.name, SPACE_FILE);
      if (!existsSync(file)) continue;
      spaces.push(productSpaceSchema.parse(JSON.parse(await readFile(file, "utf8"))));
    }
    return spaces.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(slug: string): Promise<ProductSpace> {
    const file = path.join(this.homeFor(slug), SPACE_FILE);
    if (!existsSync(file)) throw new ProductSpaceNotFoundError(slug);
    return productSpaceSchema.parse(JSON.parse(await readFile(file, "utf8")));
  }

  async create(input: CreateSpaceInput): Promise<ProductSpace> {
    const slug = input.slug ?? slugify(input.name);
    const fmHome = this.homeFor(slug);
    if (existsSync(fmHome)) throw new ProductSpaceExistsError(slug);
    await this.ensureHomesRepo();
    await mkdir(this.paths.homesRoot, { recursive: true });
    await git(["-C", this.paths.homesRepo, "worktree", "add", "-b", `space/${slug}`, fmHome, "main"]);

    for (const dir of FM_HOME_DIRS) await mkdir(path.join(fmHome, dir), { recursive: true });
    const backend = input.backend ?? detectRuntimeBackend();
    const space: ProductSpace = {
      slug,
      name: input.name,
      fmHome,
      backend,
      harness: input.harness ?? "pi",
      createdAt: this.now().toISOString(),
    };
    await this.writeDefaults(space);
    await git(["add", "-A"], fmHome);
    await git(["commit", "-q", "-m", `Create Product Space ${slug}`], fmHome);
    return space;
  }

  private async ensureHomesRepo(): Promise<void> {
    if (existsSync(path.join(this.paths.homesRepo, "HEAD"))) return;
    await mkdir(this.paths.homesRepo, { recursive: true });
    await git(["init", "-q", "--bare", "-b", "main", this.paths.homesRepo]);
    const root = await git(
      ["-C", this.paths.homesRepo, "commit-tree", EMPTY_TREE, "-m", "Amun homes root"],
    );
    await git(["-C", this.paths.homesRepo, "update-ref", "refs/heads/main", root]);
  }

  private async writeDefaults(space: ProductSpace): Promise<void> {
    const home = space.fmHome;
    const config = path.join(home, "config");
    // Defaults from the rebuild brief, under their real Firstmate names.
    await writeFile(path.join(config, "calm"), "on\n");
    await writeFile(path.join(config, "backend"), `${space.backend}\n`);
    await writeFile(path.join(config, "supervision-branch-effort"), "low\n");
    // Same contract as Firstmate's tracked .tasks.toml: tasks-axi markdown backend.
    await writeFile(
      path.join(home, ".tasks.toml"),
      [
        'backend = "markdown"',
        "",
        "[markdown]",
        'path = "data/backlog.md"',
        'archive = "data/done-archive.md"',
        "done_keep = 10",
        "",
      ].join("\n"),
    );
    await writeFile(path.join(home, "data", "backlog.md"), EMPTY_BACKLOG);
    // Runtime state and project clones stay out of the homes repository.
    await writeFile(path.join(home, ".gitignore"), "state/\nprojects/\ndata/amun-pm.db*\n");
    await writeFile(path.join(home, "state", ".keep"), "");
    await writeFile(path.join(home, "projects", ".keep"), "");
    await writeFile(path.join(home, SPACE_FILE), `${JSON.stringify(space, null, 2)}\n`);
  }
}
