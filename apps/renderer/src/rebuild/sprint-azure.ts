// Read-only Azure DevOps sprints for the Sprints Overview. Commands arrive
// through the composer; nothing here writes to Azure DevOps.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  backlogResult,
  type BacklogResult,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import { bridge } from "../bridge.ts";
import {
  browserStore,
  readBoard,
  readSource,
  writeBoard,
} from "../backlog-selection.ts";
import type { SprintCommand } from "../../../../packages/domain/src/work/planning.ts";

type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
type Reply = Extract<BacklogResult, { view: "sprints" }>;
type Intent = "load" | "refresh" | "team";

export const sprintReplies = {
  noProject: "Connect an Azure DevOps project in Product context first.",
  noTeam: "Choose a team first, like /sprint team POCs Team.",
  needName: "Tell me the team name, like /sprint team POCs Team.",
  loading: "Loading sprints…",
  loaded: (count: number, team: string) =>
    count
      ? `Showing ${count} sprint${count === 1 ? "" : "s"} for ${team}.`
      : `${team} has no current or upcoming sprints.`,
  switched: (team: string) => `Now showing ${team}.`,
  saved: (team: string) => `${team} is now your default team.`,
  lost: "Connection interrupted. Try /sprint refresh.",
};

/** Which mapped Azure project to read, as the Backlog screen chooses it. */
export function sprintSource(context: Context | null) {
  const sources = (context?.sources ?? []).filter(
    (s) => s.kind === "ado" && s.reference,
  );
  const saved = context
    ? readSource(
        browserStore(),
        context.productId,
        sources.map((s) => s.id),
      )
    : "";
  return sources.find((s) => s.id === saved) ?? sources[0] ?? null;
}

export function useAzureSprints(
  context: Context | null,
  say: (note: string) => void,
) {
  const [reply, setReply] = useState<Reply>();
  const pending = useRef<{ id: string; intent: Intent } | null>(null);
  const productId = context?.productId ?? "";
  const source = sprintSource(context);
  const sourceId = source?.id ?? "";
  const saved = () =>
    productId && sourceId
      ? readBoard(browserStore(), productId, sourceId)
      : undefined;

  const read = useCallback(
    (team: string, intent: Intent) => {
      const id = crypto.randomUUID();
      pending.current = { id, intent };
      if (intent !== "load") say(sprintReplies.loading);
      bridge.send({
        version: 1,
        kind: "backlog-read",
        action: "sprints",
        requestId: id,
        productId,
        sourceId,
        team,
      });
    },
    [productId, sourceId, say],
  );

  // Once per Sprints visit, and again if the bound project changes.
  useEffect(() => {
    setReply(undefined);
    pending.current = null;
    const team = saved()?.team;
    if (team) read(team, "load");
  }, [productId, sourceId]);

  useEffect(
    () =>
      bridge.onEvent((event) => {
        const now = pending.current;
        if (
          event &&
          typeof event === "object" &&
          "kind" in event &&
          event.kind === "service-lost" &&
          now
        ) {
          pending.current = null;
          if (now.intent !== "load") say(sprintReplies.lost);
          return;
        }
        const parsed = backlogResult.safeParse(event);
        if (
          !now ||
          !parsed.success ||
          parsed.data.requestId !== now.id ||
          parsed.data.productId !== productId
        )
          return;
        pending.current = null;
        if (parsed.data.view === "error") {
          if (now.intent !== "load") say(parsed.data.message);
          return;
        }
        if (parsed.data.view !== "sprints") return;
        setReply(parsed.data);
        if (now.intent === "refresh")
          say(
            sprintReplies.loaded(
              parsed.data.sprints.length,
              parsed.data.team.name,
            ),
          );
        if (now.intent === "team")
          say(sprintReplies.switched(parsed.data.team.name));
      }),
    [productId, say],
  );

  const run = (command: SprintCommand) => {
    if (!source) return say(sprintReplies.noProject);
    if (command.kind === "team") {
      if (!command.name) return say(sprintReplies.needName);
      return read(command.name, "team");
    }
    if (command.kind === "refresh") {
      const team = reply?.team.id ?? saved()?.team;
      return team ? read(team, "refresh") : say(sprintReplies.noTeam);
    }
    if (command.kind === "default") {
      if (!reply) return say(sprintReplies.noTeam);
      writeBoard(browserStore(), productId, sourceId, {
        team: reply.team.id,
        level: saved()?.level ?? "",
      });
      say(sprintReplies.saved(reply.team.name));
    }
  };
  return { reply, run, productId };
}
