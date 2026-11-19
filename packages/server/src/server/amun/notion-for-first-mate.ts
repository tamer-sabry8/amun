import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

/** What the First Mate may ask of Amun's Notion connection: reads only. */
export interface NotionReader {
  lookup(
    request: { kind: "search"; query: string } | { kind: "read"; page: string },
  ): Promise<string>;
}

export interface NotionForFirstMate {
  /** The command the First Mate runs: `<script> search <words>` or `<script> read <page>`. */
  script: string;
  close(): void;
}

const LIMIT = 60_000;

/**
 * Lets the First Mate read the captain's Notion through the connection Amun
 * already holds (owner, 19 November 2026: Notion showed as connected, but the
 * First Mate could not use it). The grant never leaves Amun's daemon. The
 * First Mate runs a small script in Amun's own home; it reaches the daemon
 * over a socket only this Mac user can open, and can only search and read.
 * Writing to Notion stays a reviewed plan, as before.
 */
export function serveNotionForFirstMate(input: {
  amunHome: string;
  notion: NotionReader;
}): NotionForFirstMate {
  const run = path.join(input.amunHome, "run");
  const bin = path.join(input.amunHome, "bin");
  mkdirSync(run, { recursive: true, mode: 0o700 });
  chmodSync(run, 0o700);
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const socket = path.join(run, "notion.sock");
  rmSync(socket, { force: true });

  const server: Server = createServer((request, response) => {
    const answer = (status: number, text: string) => {
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(text.length > LIMIT ? text.slice(0, LIMIT) + "\n[cut]" : text);
    };
    if (request.method !== "GET") return answer(405, "Only reads are possible.");
    const url = new URL(request.url ?? "/", "http://amun");
    const words = (url.searchParams.get("q") ?? "").trim().slice(0, 500);
    const kind =
      url.pathname === "/notion/search" ? "search" : url.pathname === "/notion/read" ? "read" : null;
    if (!kind || !words)
      return answer(400, "Use: amun-notion search <words>  or  amun-notion read <page link or id>");
    input.notion
      .lookup(kind === "search" ? { kind, query: words } : { kind, page: words })
      .then(
        (text) => answer(200, text || "Nothing found."),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          answer(
            502,
            /reconnect|grant|token|unauthor/i.test(message)
              ? "Notion is not connected in Amun. Ask the captain to connect it in Settings, Tools."
              : `Notion could not answer: ${message.slice(0, 300)}`,
          );
        },
      );
  });
  server.listen(socket, () => {
    try {
      chmodSync(socket, 0o600);
    } catch {
      // The folder is already owner-only.
    }
  });

  const script = path.join(bin, "amun-notion");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      "# Amun: read the captain's Notion (search or one page). Read only.",
      `SOCKET='${socket.replace(/'/g, "'\\''")}'`,
      'case "$1" in',
      "  search) what=search ;;",
      "  read) what=read ;;",
      '  *) echo "Use: amun-notion search <words>  or  amun-notion read <page link or id>" >&2; exit 2 ;;',
      "esac",
      "shift",
      '[ -n "$*" ] || { echo "Say what to search for or which page to read." >&2; exit 2; }',
      'exec /usr/bin/curl -sS --max-time 90 --unix-socket "$SOCKET" --get --data-urlencode "q=$*" "http://amun/notion/$what"',
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  chmodSync(script, 0o700);

  return {
    script,
    close() {
      server.close();
      rmSync(socket, { force: true });
    },
  };
}
