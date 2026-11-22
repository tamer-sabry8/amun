import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

/** What the First Mate may ask of Amun's Linear and Jira connections: reads only. */
export interface TrackerReader {
  handle(message: unknown): Promise<Record<string, unknown>>;
  targets(provider: "linear" | "jira"): Promise<string>;
}

export interface TrackersForFirstMate {
  /** `<script> status` or `<script> targets linear|jira`. */
  script: string;
  close(): void;
}

const LIMIT = 60_000;

/**
 * Lets the First Mate see whether Linear and Jira are connected and which
 * sites, projects, boards, sprints, teams and cycles a plan can name, through
 * the connections Amun holds. The grant never leaves Amun's daemon; the
 * socket is owner-only. Writing to Linear or Jira is always a plan the
 * captain approves in Amun; this script cannot write.
 */
export function serveTrackersForFirstMate(input: {
  amunHome: string;
  trackers: TrackerReader;
}): TrackersForFirstMate {
  const run = path.join(input.amunHome, "run");
  const bin = path.join(input.amunHome, "bin");
  mkdirSync(run, { recursive: true, mode: 0o700 });
  chmodSync(run, 0o700);
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const socket = path.join(run, "trackers.sock");
  rmSync(socket, { force: true });

  const server: Server = createServer((request, response) => {
    const answer = (status: number, text: string) => {
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(text.length > LIMIT ? text.slice(0, LIMIT) + "\n[cut]" : text);
    };
    if (request.method !== "GET") return answer(405, "Only reads are possible.");
    const url = new URL(request.url ?? "/", "http://amun");
    const provider = url.searchParams.get("provider");
    const failed = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      answer(
        502,
        /reconnect|connect .* first|grant|token|unauthor/i.test(message)
          ? "That tracker is not connected in Amun. Ask the captain to connect it."
          : `The tracker could not answer: ${message.slice(0, 300)}`,
      );
    };
    if (url.pathname === "/trackers/status")
      return void input.trackers.handle({ action: "list" }).then((result) => {
        const rows = (result.trackers as { provider: string; status: string }[] | undefined) ?? [];
        answer(200, rows.map((row) => `${row.provider}: ${row.status}`).join("\n"));
      }, failed);
    if (url.pathname === "/trackers/targets" && (provider === "linear" || provider === "jira"))
      return void input.trackers.targets(provider).then((text) => answer(200, text), failed);
    answer(400, "Use: amun-tracker status  or  amun-tracker targets linear|jira");
  });
  server.listen(socket, () => {
    try {
      chmodSync(socket, 0o600);
    } catch {
      // The folder is already owner-only.
    }
  });

  const script = path.join(bin, "amun-tracker");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      "# Amun: Linear and Jira connection status and plan targets. Read only.",
      `SOCKET='${socket.replace(/'/g, "'\\''")}'`,
      'case "$1" in',
      '  status) exec /usr/bin/curl -sS --max-time 30 --unix-socket "$SOCKET" "http://amun/trackers/status" ;;',
      '  targets) case "$2" in linear|jira) exec /usr/bin/curl -sS --max-time 120 --unix-socket "$SOCKET" "http://amun/trackers/targets?provider=$2" ;; esac ;;',
      "esac",
      'echo "Use: amun-tracker status  or  amun-tracker targets linear|jira" >&2',
      "exit 2",
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
