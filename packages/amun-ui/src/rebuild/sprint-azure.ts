// Read-only Azure DevOps sprints for the Sprints Overview. Commands arrive
// through the composer; nothing here writes to Azure DevOps.
import { useCallback, useEffect, useRef, useState } from "react";
import { backlogResult, type BacklogResult } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { browserStore } from "../backlog-selection.ts";
import {
  resolveSprintBinding,
  writeSprintDefault,
  type SprintArea,
} from "./sprint-binding.ts";
import {
  adoSprintsLine,
  type AdoSprint,
  type SprintCommand,
} from "../../../../packages/domain/src/work/planning.ts";

type Reply = Extract<BacklogResult, { view: "sprints" }>;
export type SprintItems = {
  sprint: string;
  state: "loading" | "ready" | "error";
  items: Extract<BacklogResult, { view: "sprint-items" }>["items"];
  more: boolean;
};
type Intent = "load" | "refresh" | "team";

export const sprintReplies = {
  noProject:
    "Choose the Azure DevOps project in this project’s Backlog panel first.",
  silent: "Azure DevOps did not answer. Try /sprint refresh again.",
  noTeam: "Choose a team first, like /sprint team POCs Team.",
  needName: "Tell me the team name, like /sprint team POCs Team.",
  loading: "Loading sprints…",
  loaded: (sprints: AdoSprint[], team: string, now = Date.now()) =>
    adoSprintsLine(sprints, team, now),
  switched: (team: string) => `Now showing ${team}.`,
  saved: (team: string) => `${team} is now your default team.`,
  lost: "Connection interrupted. Try /sprint refresh.",
  itemsLoading: "Loading the work items…",
  itemsLost: "I couldn’t load this sprint’s work items. Try /sprint refresh.",
  itemsNone: "This sprint has no work items yet.",
  itemsMore: "Showing the first 200 work items.",
};

export const sprintTimeoutMs = 20_000;

export function useAzureSprints(
  areas: readonly SprintArea[],
  areaId: string,
  say: (note: string) => void,
) {
  const [reply, setReply] = useState<Reply>();
  const [items, setItems] = useState<SprintItems | null>(null);
  const itemsPending = useRef<{ id: string; sprint: string } | null>(null);
  const pending = useRef<{ id: string; intent: Intent } | null>(null);
  const binding = resolveSprintBinding(browserStore(), areas, areaId);
  const productId = binding?.productId ?? "";
  const sourceId = binding?.sourceId ?? "";
  const savedTeam = binding?.team ?? "";

  const read = useCallback(
    (team: string, intent: Intent) => {
      const id = crypto.randomUUID();
      pending.current = { id, intent };
      if (intent !== "load") say(sprintReplies.loading);
      // A request that gets no answer must not leave "Loading" on screen.
      setTimeout(() => {
        if (pending.current?.id !== id) return;
        pending.current = null;
        if (intent !== "load") say(sprintReplies.silent);
      }, sprintTimeoutMs);
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

  // Read-only: the work items of one Azure sprint, asked when it is opened.
  const readItems = useCallback(
    (team: string, sprint: string) => {
      const id = crypto.randomUUID();
      itemsPending.current = { id, sprint };
      setItems({ sprint, state: "loading", items: [], more: false });
      setTimeout(() => {
        if (itemsPending.current?.id !== id) return;
        itemsPending.current = null;
        setItems({ sprint, state: "error", items: [], more: false });
        say(sprintReplies.silent);
      }, sprintTimeoutMs);
      bridge.send({
        version: 1,
        kind: "backlog-read",
        action: "sprint-items",
        requestId: id,
        productId,
        sourceId,
        team,
        sprint,
      });
    },
    [productId, sourceId],
  );

  // Once per Sprints visit, and again if the bound project changes.
  useEffect(() => {
    setReply(undefined);
    setItems(null);
    itemsPending.current = null;
    pending.current = null;
    if (savedTeam) read(savedTeam, "load");
  }, [productId, sourceId, savedTeam]);

  useEffect(
    () =>
      bridge.onEvent((event) => {
        const asked = itemsPending.current;
        if (asked) {
          if (
            event &&
            typeof event === "object" &&
            "kind" in event &&
            event.kind === "service-lost"
          ) {
            itemsPending.current = null;
            setItems({
              sprint: asked.sprint,
              state: "error",
              items: [],
              more: false,
            });
            say(sprintReplies.itemsLost);
          } else {
            const result = backlogResult.safeParse(event);
            if (
              result.success &&
              result.data.requestId === asked.id &&
              result.data.productId === productId
            ) {
              itemsPending.current = null;
              if (result.data.view === "sprint-items") {
                setItems({
                  sprint: asked.sprint,
                  state: "ready",
                  items: result.data.items,
                  more: result.data.more,
                });
                if (result.data.more) say(sprintReplies.itemsMore);
              } else {
                setItems({
                  sprint: asked.sprint,
                  state: "error",
                  items: [],
                  more: false,
                });
                say(sprintReplies.itemsLost);
              }
              return;
            }
          }
        }
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
          say(sprintReplies.loaded(parsed.data.sprints, parsed.data.team.name));
        if (now.intent === "team")
          say(sprintReplies.switched(parsed.data.team.name));
      }),
    [productId, say],
  );

  const run = (command: SprintCommand) => {
    if (command.kind === "refresh" && items && reply) {
      const team = reply.team.id;
      readItems(team, items.sprint);
    }
    if (!binding) return say(sprintReplies.noProject);
    if (command.kind === "team") {
      if (!command.name) return say(sprintReplies.needName);
      return read(command.name, "team");
    }
    if (command.kind === "refresh") {
      const team = reply?.team.id ?? savedTeam;
      return team ? read(team, "refresh") : say(sprintReplies.noTeam);
    }
    if (command.kind === "default") {
      if (!reply) return say(sprintReplies.noTeam);
      writeSprintDefault(browserStore(), {
        productId,
        sourceId,
        team: reply.team.id,
      });
      say(sprintReplies.saved(reply.team.name));
    }
  };
  return {
    reply,
    run,
    productId,
    items,
    openSprint: (sprint: string) =>
      reply ? readItems(reply.team.id, sprint) : undefined,
  };
}
