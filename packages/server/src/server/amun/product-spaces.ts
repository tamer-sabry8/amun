import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  productSpaceSchema,
  runtimeBackendSchema,
  type PrimaryHarness,
  type ProductSpace,
  type RuntimeBackend,
} from "@getpaseo/protocol/amun-rpc";
import type { AmunPaths } from "./amun-paths.js";

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

export function findOnPath(
  binary: string,
  pathValue: string = process.env.PATH ?? "",
): string | null {
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
  return findOnPath("herdr-core", pathValue) || findOnPath("hc", pathValue)
    ? "hc"
    : "tmux";
}

/**
 * The home's own runtime choice wins (config/backend, read only); otherwise
 * what is installed on PATH. Amun never writes config/backend.
 */
export function homeRuntimeBackend(
  fmHome: string,
  pathValue?: string,
): RuntimeBackend {
  try {
    const parsed = runtimeBackendSchema.safeParse(
      readFileSync(path.join(fmHome, "config", "backend"), "utf8").trim(),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // no config/backend in the home
  }
  return detectRuntimeBackend(pathValue);
}

export interface CreateSpaceInput {
  name: string;
  slug?: string;
  harness?: PrimaryHarness;
}

/**
 * Products are Amun's own records (~/.amun/products/<slug>.json). Every product
 * points at the captain's single existing Firstmate home; creating one never
 * touches that home (Tamer, 2026-11-18: one home for everything).
 */
export class ProductSpaceStore {
  constructor(
    private readonly paths: AmunPaths,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private fileFor(slug: string): string {
    return path.join(this.paths.productsRoot, `${slug}.json`);
  }

  private hydrate(raw: unknown): ProductSpace {
    // fmHome always reflects the current home setting, not the one saved at creation.
    return productSpaceSchema.parse({
      ...(raw as object),
      fmHome: this.paths.fmHome,
    });
  }

  async list(): Promise<ProductSpace[]> {
    if (!existsSync(this.paths.productsRoot)) return [];
    const entries = await readdir(this.paths.productsRoot, {
      withFileTypes: true,
    });
    const spaces: ProductSpace[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(this.paths.productsRoot, entry.name);
      spaces.push(this.hydrate(JSON.parse(await readFile(file, "utf8"))));
    }
    return spaces.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(slug: string): Promise<ProductSpace> {
    const file = this.fileFor(slug);
    if (!existsSync(file)) throw new ProductSpaceNotFoundError(slug);
    return this.hydrate(JSON.parse(await readFile(file, "utf8")));
  }

  async create(input: CreateSpaceInput): Promise<ProductSpace> {
    const slug = input.slug ?? slugify(input.name);
    const file = this.fileFor(slug);
    if (existsSync(file)) throw new ProductSpaceExistsError(slug);
    const space: ProductSpace = {
      slug,
      name: input.name,
      fmHome: this.paths.fmHome,
      backend: homeRuntimeBackend(this.paths.fmHome),
      harness: input.harness ?? "pi",
      createdAt: this.now().toISOString(),
    };
    await mkdir(this.paths.productsRoot, { recursive: true });
    await writeFile(file, `${JSON.stringify(space, null, 2)}\n`, {
      flag: "wx",
    });
    return space;
  }
}
