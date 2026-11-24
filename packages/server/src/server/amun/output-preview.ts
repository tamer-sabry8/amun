import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

const PROTOTYPE_TYPE = "prototype";
const MAX_PREVIEW_HTML = 500_000;
const WHOLE_PAGE = /^\s*(?:<!doctype\s+html|<html[\s>])/i;
const FENCED_HTML = /```html[^\S\n]*\n([\s\S]*?)\n```/i;
const LOCAL_LINK =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#][^\s<>"')\]]*)?/i;

const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_PREVIEWS = 8;

export interface PreviewSnapshotLike {
  setup?: { activeGroupId?: string | null };
  areas?: { id: string; groupId: string | null }[];
  library?: {
    id: string;
    groupId: string | null;
    type: string;
    title: string;
    body: string;
    version: number;
    workAreaIds: string[];
  }[];
}

export interface OutputPreviewOpened {
  ok: true;
  url: string;
  outputId: string;
  title: string;
  version: number;
  message: string;
}

export interface OutputPreviewDenied {
  ok: false;
  message: string;
}

export type OutputPreviewResponse = OutputPreviewOpened | OutputPreviewDenied;

interface ActivePreview {
  url: string;
  outputId: string;
  expiresAt: number;
  server: Server;
  timer: ReturnType<typeof setTimeout>;
  closed: boolean;
}

export interface OutputPreviewHostOptions {
  ttlMs?: number;
  maxPreviews?: number;
  now?: () => number;
}

function extractSelfContainedHtml(body: string): { kind: "html"; html: string } | { kind: "url" } | null {
  const page = WHOLE_PAGE.test(body) ? body : FENCED_HTML.exec(body)?.[1];
  if (page?.trim() && page.length <= MAX_PREVIEW_HTML) {
    return { kind: "html", html: page };
  }
  if (LOCAL_LINK.test(body)) {
    return { kind: "url" };
  }
  return null;
}

/**
 * Verifies full lineage at preview-open time:
 * - output exists in the current work snapshot
 * - output has type "prototype"
 * - if an areaId is supplied, the area exists and the output belongs to that
 *   area or shares the same non-null group
 * - body contains a single self-contained HTML page within the size limit
 */
export function resolvePreviewTarget(
  snapshot: PreviewSnapshotLike,
  outputId: string,
  areaId?: string,
): { ok: true; html: string; title: string; version: number } | OutputPreviewDenied {
  const output = (snapshot.library ?? []).find((item) => item.id === outputId);
  if (!output) {
    return { ok: false, message: "That wireframe is no longer in your Library." };
  }
  if (output.type !== PROTOTYPE_TYPE) {
    return {
      ok: false,
      message: "Only saved wireframe artifacts can open in the interactive preview.",
    };
  }
  const activeGroupId = snapshot.setup?.activeGroupId ?? null;
  if (areaId !== undefined) {
    const area = (snapshot.areas ?? []).find((candidate) => candidate.id === areaId);
    if (!area) {
      return { ok: false, message: "That work area could not be verified for preview." };
    }
    if (activeGroupId !== null && area.groupId !== null && area.groupId !== activeGroupId) {
      return {
        ok: false,
        message: "That work area belongs to a different group and cannot be previewed here.",
      };
    }
    const inArea = output.workAreaIds.includes(area.id);
    const sameGroup = area.groupId !== null && output.groupId === area.groupId;
    if (!inArea && !sameGroup) {
      return {
        ok: false,
        message: "That wireframe belongs to a different work group and cannot be previewed here.",
      };
    }
  } else if (activeGroupId !== null && output.groupId !== null && output.groupId !== activeGroupId) {
    return {
      ok: false,
      message: "That wireframe belongs to a different work group and cannot be previewed here.",
    };
  }
  const source = extractSelfContainedHtml(output.body);
  if (!source) {
    return {
      ok: false,
      message:
        "This wireframe does not contain a complete self-contained HTML page to preview.",
    };
  }
  if (source.kind !== "html") {
    return {
      ok: false,
      message:
        "Only self-contained HTML wireframes can open in the offline preview. External or local server links are blocked.",
    };
  }
  return {
    ok: true,
    html: source.html,
    title: output.title,
    version: output.version,
  };
}

/**
 * Serves verified self-contained HTML wireframes from private loopback servers
 * with 256-bit unguessable path tokens, strict offline CSP, bounded TTL, and a
 * hard cap on concurrent previews. Closed cleanly on pane close or daemon exit.
 */
export class OutputPreviewHost {
  private readonly active = new Map<string, ActivePreview>();
  private readonly ttlMs: number;
  private readonly maxPreviews: number;
  private readonly now: () => number;
  private closed = false;

  constructor(options: OutputPreviewHostOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxPreviews = options.maxPreviews ?? DEFAULT_MAX_PREVIEWS;
    this.now = options.now ?? (() => Date.now());
  }

  get activeCount(): number {
    return this.active.size;
  }

  async open(
    snapshot: PreviewSnapshotLike,
    outputId: string,
    areaId?: string,
  ): Promise<OutputPreviewResponse> {
    if (this.closed) {
      return { ok: false, message: "Preview service is shutting down." };
    }
    const target = resolvePreviewTarget(snapshot, outputId, areaId);
    if (!target.ok) return target;

    const tokenPath = "/" + randomBytes(32).toString("hex");
    let origin = "";
    const expiresAt = this.now() + this.ttlMs;
    const entry: ActivePreview = {
      url: "",
      outputId,
      expiresAt,
      server: null as unknown as Server,
      timer: null as unknown as ReturnType<typeof setTimeout>,
      closed: false,
    };

    const server = createServer((req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Security-Policy", PREVIEW_CSP);
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (
        this.closed ||
        entry.closed ||
        this.now() > entry.expiresAt ||
        req.url !== tokenPath ||
        "http://" + String(req.headers.host ?? "") !== origin
      ) {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(target.html);
    });
    server.requestTimeout = 10_000;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    if (this.closed) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return { ok: false, message: "Preview service is shutting down." };
    }

    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    entry.url = origin + tokenPath;
    entry.server = server;
    entry.timer = setTimeout(() => {
      void this.closeUrl(entry.url);
    }, this.ttlMs);
    entry.timer.unref();

    // Enforce hard cap by evicting oldest active preview(s).
    while (this.active.size >= this.maxPreviews) {
      const oldestUrl = this.active.keys().next().value;
      if (!oldestUrl) break;
      await this.closeUrl(oldestUrl);
    }

    if (this.closed) {
      clearTimeout(entry.timer);
      entry.closed = true;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return { ok: false, message: "Preview service is shutting down." };
    }

    this.active.set(entry.url, entry);
    return {
      ok: true,
      url: entry.url,
      outputId,
      title: target.title,
      version: target.version,
      message: "",
    };
  }

  async closeUrl(url: string): Promise<void> {
    const entry = this.active.get(url);
    if (!entry) return;
    this.active.delete(url);
    entry.closed = true;
    clearTimeout(entry.timer);
    entry.server.closeAllConnections();
    await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    const urls = [...this.active.keys()];
    await Promise.all(urls.map((url) => this.closeUrl(url)));
  }
}
