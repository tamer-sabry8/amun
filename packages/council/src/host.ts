// Hosts the Council inside Amun's daemon: the real process spawning, the
// owner-question helper Claude Code starts, the room viewer and the shipped
// Roast Room version. The Council's own logic stays in service.ts.
import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
} from "node:fs";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { councilCommand } from "../../contracts/src/work.ts";
import { pending } from "./bridge.ts";
import { gitFetcher } from "./git-fetcher.ts";
import { Room } from "./room.ts";
import type { Pin } from "./runtime.ts";
import { CouncilService, type CouncilRecords } from "./service.ts";

export interface CouncilHostOptions {
  /** Amun's own folder for the Council (advisors, sessions, bridge). */
  root: string;
  records: CouncilRecords & { snapshot(): unknown };
  /** The pristine Roast Room staged with this build (holds pin.json), if any. */
  vendor?: string | null;
  /** The built owner-question tool server (a single self-contained script). */
  askServerSource: string;
  /** Runs Node scripts: the daemon's own executable. */
  node?: string;
  path?: () => string;
  home?: string;
}

/** The Roast Room version staged with this build (scripts/stage-roast-room.ts). */
export function shippedPin(
  vendor: string | null | undefined,
): { directory: string; pin: Pin } | null {
  if (!vendor) return null;
  try {
    const pin = JSON.parse(
      readFileSync(join(vendor, "pin.json"), "utf8"),
    ) as Pin;
    if (
      typeof pin.repository !== "string" ||
      !/^[a-f0-9]{40}$/.test(pin.commit) ||
      !/^[a-f0-9]{64}$/.test(pin.sha256)
    )
      return null;
    return { directory: join(vendor, pin.commit), pin };
  } catch {
    return null;
  }
}

/** Claude Code on this Mac: its usual install places, then the PATH. */
export async function findClaude(
  home = homedir(),
  path = process.env.PATH ?? "",
): Promise<string | null> {
  const candidates = [
    join(home, ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    ...path
      .split(delimiter)
      .filter((entry) => entry.startsWith("/"))
      .map((entry) => join(entry, "claude")),
  ];
  for (const candidate of candidates)
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; keep looking.
    }
  return null;
}

/**
 * The reason Claude Code gave for stopping, from the last result line of its
 * stream output (for example an expired sign-in). Null when it gave none.
 */
export async function chairFailure(outputPath: string): Promise<string | null> {
  const text = await readFile(outputPath, "utf8").catch(() => "");
  for (const line of text.trim().split("\n").reverse()) {
    let event: { type?: unknown; is_error?: unknown; result?: unknown };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    if (event.type !== "result") continue;
    return event.is_error === true && typeof event.result === "string"
      ? event.result.trim().slice(0, 400) || null
      : null;
  }
  return null;
}

export class CouncilHost {
  private readonly service: CouncilService;
  private readonly bridge: string;
  private readonly askServer: string;
  private readonly askServerSource: string;
  /** Counts councils finishing, so the UI is told once when one ends. */
  private finished = 0;
  private lastDigest = "";

  constructor(private readonly options: CouncilHostOptions) {
    const node = options.node ?? process.execPath;
    // Under Electron the daemon's executable runs scripts only in Node mode;
    // plain Node ignores the variable.
    const nodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
    this.bridge = join(options.root, "bridge");
    this.askServer = join(options.root, "ask-server.mjs");
    this.askServerSource = options.askServerSource;
    let room: Room | null = null;
    this.service = new CouncilService({
      root: options.root,
      records: options.records,
      findClaude: () =>
        findClaude(
          options.home ?? homedir(),
          options.path?.() ?? process.env.PATH ?? "",
        ),
      spawn: ({ command, args, cwd, stdin }) => {
        // The last run's output is kept in Amun's own folder, so a Chair
        // that stops early can say why.
        const outputPath = join(options.root, "chair-output.jsonl");
        const output = openSync(outputPath, "w", 0o600);
        const log = openSync(join(options.root, "chair.log"), "w", 0o600);
        const child = spawn(command, args, {
          cwd,
          stdio: ["pipe", output, log],
        });
        closeSync(output);
        closeSync(log);
        child.stdin?.end(stdin);
        return {
          done: new Promise<number>((resolve) => {
            const end = (code: number) => {
              this.finished += 1;
              resolve(code);
            };
            child.once("error", () => end(1));
            child.once("exit", (code) => end(code ?? 1));
          }),
          stop: () => child.kill(),
          failure: () => chairFailure(outputPath),
        };
      },
      askServer: { command: node, args: [this.askServer], env: nodeEnv },
      fetcher: gitFetcher,
      bundledNode: process.versions.node,
      room: {
        start: (directory) => {
          room?.stop();
          room = new Room(directory, { node, env: nodeEnv });
          return room.start();
        },
        stop: () => {
          room?.stop();
          room = null;
        },
      },
      shipped: shippedPin(options.vendor),
    });
  }

  /**
   * Claude Code starts the question helper as its own process, so the script
   * has to be a real file: it is copied out of the app bundle before a run.
   */
  private async placeAskServer(): Promise<void> {
    await mkdir(this.options.root, { recursive: true });
    if (existsSync(this.askServerSource))
      await copyFile(this.askServerSource, this.askServer);
  }

  /** One renderer "council" command; answers with the events the UI reads. */
  async handle(message: unknown): Promise<unknown[]> {
    const command = councilCommand.parse(message);
    const events: unknown[] = [];
    if (command.action === "run") {
      await this.placeAskServer();
      const started = await this.service.run(command);
      events.push({
        version: 1,
        kind: "work-result",
        action: "council-run",
        ok: started.ok,
        message: started.ok ? "" : started.reason,
        ref: started.ok ? started.sessionId : null,
        step: null,
      });
      events.push(this.options.records.snapshot());
    }
    events.push(
      command.action === "toggle-seat"
        ? await this.service.toggleSeat(command.key, command.disabled)
        : command.action === "check-update"
          ? await this.service.checkUpdate(true)
          : command.action === "rollback"
            ? await this.service.rollback()
            : command.action === "room"
              ? await this.service.openRoom()
              : command.action === "close-room"
                ? await this.service.closeRoom()
                : await this.service.status(),
    );
    return events;
  }

  /**
   * Moves Chair questions to the owner and answers back. Resolves true when
   * something the UI shows has changed (a new question, or a council ended).
   */
  async poll(): Promise<boolean> {
    await this.service.poll();
    const waiting = await pending(this.bridge).catch(() => []);
    const digest = `${this.finished}|${waiting.map((item) => item.id).join(",")}`;
    const changed = digest !== this.lastDigest;
    this.lastDigest = digest;
    return changed;
  }

  /** The weekly, validated update check. */
  async checkUpdate(): Promise<void> {
    await this.service.checkUpdate();
  }

  stop(): void {
    this.service.stop();
  }
}
