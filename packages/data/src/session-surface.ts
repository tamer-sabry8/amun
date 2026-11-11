import type Database from "better-sqlite3";
import {
  cliUsage,
  parseCli,
  sessionReference,
  type Surface,
} from "../../domain/src/session-ref.ts";
import {
  trajectorySources,
  type TrajectoryEvent,
  type TrajectorySource,
} from "../../domain/src/trajectory.ts";
import { Trajectory } from "./trajectory.ts";

export interface SurfaceState {
  reference: string;
  title: string;
  state: string;
  done: string[];
  pending: string[];
  failed: string[];
  needsDecision: { eventId: string; summary: string }[];
  lastSurface: Surface | null;
}

export interface CliResult {
  exitCode: number;
  output: string;
}

/**
 * One session, two ways in. Chat and command line read and write the same
 * trajectory, so history, approvals and audit are identical whichever
 * surface acted. Every action records which surface and who.
 */
export class SessionSurface {
  private readonly trajectory: Trajectory;
  constructor(
    db: Database.Database,
    trajectory: Trajectory = new Trajectory(db),
  ) {
    this.trajectory = trajectory;
  }

  state(sessionId: string): SurfaceState {
    const session = this.trajectory.session(sessionId);
    const events = this.trajectory.events(sessionId);
    const brief = this.trajectory.resume(sessionId);
    const handoff = events.findLast((e) => e.kind === "handoff");
    return {
      reference: sessionReference(sessionId),
      title: session.title,
      state: brief.state,
      done: brief.done,
      pending: brief.incomplete.map((e) => e.summary),
      failed: brief.openErrors.map((e) => e.summary),
      needsDecision: brief.approvalsNeeded.map((e) => ({
        eventId: e.id,
        summary: e.summary,
      })),
      lastSurface: handoff
        ? ((handoff.detail as { to?: Surface }).to ?? null)
        : null,
    };
  }

  /** Records that work moves to another surface and returns what it needs. */
  handoff(
    sessionId: string,
    from: Surface,
    to: Surface,
    actor: string,
  ): SurfaceState & { command: string } {
    if (from === to) throw Error("The session is already on that surface");
    if (!actor.trim()) throw Error("Name who is moving the session");
    this.trajectory.append(sessionId, {
      source: "system",
      kind: "handoff",
      participant: `${from}:${actor}`,
      summary: `Continued in ${to === "cli" ? "the terminal" : to === "chat" ? "the chat" : "an automation"}`,
      detail: { from, to },
    });
    const state = this.state(sessionId);
    return { ...state, command: "amun session status " + state.reference };
  }

  /** Adds an instruction from either surface, attributed to it. */
  say(
    sessionId: string,
    surface: Surface,
    actor: string,
    message: string,
  ): TrajectoryEvent {
    return this.trajectory.append(sessionId, {
      source: "user",
      kind: "request",
      participant: `${surface}:${actor}`,
      summary: message.trim().slice(0, 4096),
    });
  }

  /**
   * Answers an approval request. The request must be open and in this
   * session; the answer is recorded the same way from chat or terminal.
   */
  decide(
    sessionId: string,
    surface: Surface,
    actor: string,
    eventId: string,
    decision: "approve" | "reject",
    reason = "",
  ): TrajectoryEvent {
    const open = this.trajectory.resume(sessionId).approvalsNeeded;
    const request = open.find((event) => event.id === eventId);
    if (!request)
      throw Error("No open approval request with that id in this session");
    if (surface === "automation")
      throw Error("An automation cannot answer an approval; a person must");
    return this.trajectory.append(sessionId, {
      source: "approval",
      kind: decision === "approve" ? "granted" : "rejected",
      participant: `${surface}:${actor}`,
      summary: `${decision === "approve" ? "Approved" : "Rejected"}: ${request.summary}`,
      detail: reason.trim() ? { reason: reason.trim() } : {},
      refersTo: eventId,
    });
  }

  /** Runs one command line. Text for people, JSON with --json for scripts. */
  cli(
    argv: readonly string[],
    actor: string,
    surface: "cli" | "automation" = "cli",
  ): CliResult {
    let json = argv.includes("--json");
    const reply = (value: unknown, text: string): CliResult => ({
      exitCode: 0,
      output: json ? JSON.stringify(value) : text,
    });
    try {
      const command = parseCli(argv);
      json = command.json;
      if (command.name === "help") return reply({ usage: cliUsage }, cliUsage);
      const id = command.session!;
      if (command.name === "ref")
        return reply({ reference: sessionReference(id) }, sessionReference(id));
      if (command.name === "status") {
        const state = this.state(id);
        const list = (title: string, items: readonly string[]) =>
          items.length
            ? [title + ":", ...items.map((item) => "  - " + item)]
            : [];
        return reply(
          state,
          [
            `${state.title} · ${state.state.replace("_", " ")}`,
            state.reference,
            ...list("Done", state.done),
            ...list("Pending", state.pending),
            ...list("Failed", state.failed),
            ...list(
              "Needs a decision",
              state.needsDecision.map((d) => `${d.summary} (${d.eventId})`),
            ),
          ].join("\n"),
        );
      }
      if (command.name === "events" || command.name === "search") {
        const sources = (command.sources ?? []).map((source) => {
          if (!trajectorySources.includes(source as TrajectorySource))
            throw Error(`Unknown source "${source}"`);
          return source as TrajectorySource;
        });
        const events = this.trajectory.events(id, {
          ...(command.text ? { text: command.text } : {}),
          ...(sources.length ? { sources } : {}),
        });
        return reply(
          events,
          events.length
            ? events
                .map(
                  (e) =>
                    `#${e.seq} ${e.at} [${e.source}] ${e.participant}: ${e.summary}`,
                )
                .join("\n")
            : "No events match.",
        );
      }
      if (command.name === "say") {
        const event = this.say(id, surface, actor, command.text!);
        return reply(event, `Added as #${event.seq}`);
      }
      if (command.name === "decide") {
        const event = this.decide(
          id,
          surface,
          actor,
          command.eventId!,
          command.decision!,
          command.text,
        );
        return reply(event, event.summary);
      }
      const state = this.handoff(id, surface, "chat", actor);
      return reply(state, "Open in chat: " + state.reference);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        exitCode: 1,
        output: json ? JSON.stringify({ error: message }) : "Error: " + message,
      };
    }
  }
}
