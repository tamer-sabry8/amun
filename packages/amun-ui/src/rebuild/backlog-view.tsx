import { StoryDraftEditor } from "./story-draft-editor.tsx";
// The Backlog pane. Same messages, remembered choices and checks as the earlier
// Backlog (story drafts, project, team, level, work items, edits, publishing);
// only the view is new.
import { useEffect, useRef, useState } from "react";
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
  writeSource,
} from "../backlog-selection.ts";
import { AzureWorkReview, CardEdit } from "./azure-review-view.tsx";
import { BacklogSetup } from "./backlog-setup-view.tsx";
import { DecisionReview, StoryImplementation } from "./story-views.tsx";
import { Choice, divided, list, stack, type Option } from "./view-parts.tsx";

type Context = NonNullable<WorkspaceSnapshot["productContext"]>;

export function Backlog({ context }: { context: Context }) {
  const sources = context.sources.filter((s) => s.kind === "ado");
  const mapped = sources.map((s) => s.id);
  const [sourceId, setSource] = useState(() =>
    readSource(browserStore(), context.productId, mapped),
  );
  // A project that is no longer mapped is dropped; a remembered one returns
  // when the product's sources arrive after the first render.
  useEffect(() => {
    if (sourceId && mapped.includes(sourceId)) return;
    setSource(readSource(browserStore(), context.productId, mapped));
  }, [context.productId, mapped.join("\n"), sourceId]);
  return (
    <section
      aria-label="Azure DevOps backlog"
      style={{ ...stack, gap: 14, maxWidth: "72ch" }}
    >
      {context.storyDrafts.length > 0 && (
        <section style={stack} aria-label="Story drafts">
          <h3>Proposed stories</h3>
          {context.storyDrafts
            .filter((d) => !d.parentId)
            .map((story) => (
              <article key={story.id} style={divided}>
                <h3>{story.title}</h3>
                <p className="muted small">
                  PRD v{story.version} · {story.requirementId}
                </p>
                <p className="muted">{story.requirement}</p>
                <ul style={list} aria-label="Acceptance criteria">
                  {story.acceptance.map((criterion, i) => (
                    <li key={i}>{criterion}</li>
                  ))}
                </ul>
                <ul style={list} aria-label="Tasks">
                  {context.storyDrafts
                    .filter((d) => d.parentId === story.id)
                    .map((task) => (
                      <li key={task.id}>{task.title}</li>
                    ))}
                </ul>
                {context.storyDecisions
                  .filter((d) => d.itemId === story.id)
                  .map((d) => (
                    <DecisionReview
                      key={d.id}
                      productId={context.productId}
                      decision={d}
                    />
                  ))}
                {!context.storyDecisions.some(
                  (d) => d.itemId === story.id && d.state !== "resolved",
                ) && (
                  <div className="row">
                    <button
                      className="btn"
                      disabled={!context.allowedModels.length}
                      onClick={() =>
                        bridge.send({
                          version: 1,
                          kind: "product-authoring",
                          action: "story-decision",
                          productId: context.productId,
                          itemId: story.id,
                          model: context.allowedModels[0],
                        })
                      }
                    >
                      Ask Firstmate for decision options
                    </button>
                  </div>
                )}
                <StoryDraftEditor story={story} context={context} />
                <StoryImplementation context={context} story={story.id} />
              </article>
            ))}
        </section>
      )}

      {sources.length ? (
        <>
          <Choice
            label="Project"
            options={sources.map((s) => ({ id: s.id, name: s.title }))}
            value={sourceId}
            onChange={(id) => {
              writeSource(browserStore(), context.productId, id);
              setSource(id);
            }}
          />
          {sources.some((s) => s.id === sourceId) && (
            <details>
              <summary className="link small">Change this project</summary>
              <div style={{ marginTop: 8 }}>
                <BacklogSetup
                  key={sourceId}
                  productId={context.productId}
                  source={sources.find((s) => s.id === sourceId)!}
                />
              </div>
            </details>
          )}
          {sources.some((s) => s.id === sourceId) && (
            <TeamBoard
              context={context}
              key={sourceId}
              sourceId={sourceId}
              productId={context.productId}
            />
          )}
        </>
      ) : (
        <>
          <p className="muted">
            Connect an Azure DevOps project to open its backlog.
          </p>
          <BacklogSetup card productId={context.productId} />
        </>
      )}
    </section>
  );
}

function TeamBoard({
  context,
  sourceId,
  productId,
}: {
  context: Context;
  sourceId: string;
  productId: string;
}) {
  const [teams, setTeams] = useState<Option[]>([]),
    [team, setTeam] = useState("");
  const [options, setOptions] =
      useState<Extract<BacklogResult, { view: "options" }>>(),
    [level, setLevel] = useState("");
  const [result, setResult] =
      useState<Extract<BacklogResult, { view: "cards" }>>(),
    [view, setView] = useState("list"),
    [status, setStatus] = useState("");
  const [schema, setSchema] =
    useState<Extract<BacklogResult, { view: "schema" }>["schema"]>();
  const pending = useRef("");
  // What was chosen last time, until it has been checked against Azure.
  const restoring = useRef(readBoard(browserStore(), productId, sourceId));
  function remember(selection: { team: string; level: string } | undefined) {
    writeBoard(browserStore(), productId, sourceId, selection);
  }
  function send(action: string, fields: Record<string, string> = {}) {
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setStatus("Loading…");
    bridge.send({
      version: 1,
      kind: "backlog-read",
      action,
      requestId,
      productId,
      sourceId,
      ...fields,
    });
  }
  useEffect(() => {
    if (restoring.current) send("teams");
  }, []);
  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (
          event &&
          typeof event === "object" &&
          "kind" in event &&
          event.kind === "service-lost"
        ) {
          pending.current = "";
          setResult(undefined);
          setStatus(
            "The connection was interrupted. Choose Find teams to retry.",
          );
          return;
        }
        const parsed = backlogResult.safeParse(event);
        if (
          !parsed.success ||
          parsed.data.requestId !== pending.current ||
          parsed.data.productId !== productId
        )
          return;
        pending.current = "";
        const reply = parsed.data;
        setStatus(reply.view === "error" ? reply.message : "");
        const saved = restoring.current;
        if (reply.view === "teams") {
          setTeams(reply.teams);
          if (saved?.team) {
            if (reply.teams.some((t) => t.id === saved.team)) {
              setTeam(saved.team);
              send("options", { team: saved.team });
            } else {
              restoring.current = undefined;
              remember(undefined);
              setStatus(
                "The team you used before is no longer available. Choose a team.",
              );
            }
          }
        }
        if (reply.view === "options") {
          setOptions(reply);
          if (saved) {
            restoring.current = undefined;
            if (saved.level && reply.levels.some((l) => l.id === saved.level))
              setLevel(saved.level);
            else {
              remember({ team: saved.team, level: "" });
              if (saved.level)
                setStatus(
                  "The backlog level you used before is no longer available. Choose a level.",
                );
            }
          }
        }
        if (reply.view === "error" && saved) {
          restoring.current = undefined;
          setStatus(
            "Your earlier team and level could not be restored. " +
              reply.message,
          );
        }
        if (reply.view === "schema") setSchema(reply.schema);
        if (reply.view === "cards") setResult(reply);
      }),
    [productId],
  );
  function clearBoard() {
    setOptions(undefined);
    setLevel("");
    setResult(undefined);
  }
  const scope = { productId, sourceId, team };
  return (
    <>
      <div className="row wrap">
        <button
          className="btn"
          onClick={() => {
            restoring.current = undefined;
            remember(undefined);
            setTeams([]);
            setTeam("");
            clearBoard();
            send("teams");
          }}
        >
          Find teams
        </button>
        <button className="btn" onClick={() => send("schema")}>
          Show how this project works
        </button>
      </div>
      {schema && (
        <details open>
          <summary className="link small">
            {schema.process ?? "How this project works"}
          </summary>
          <div style={{ ...stack, marginTop: 8 }}>
            <p className="muted small">Areas: {schema.areas.join(", ")}</p>
            <p className="muted small">
              Sprints: {schema.iterations.join(", ")}
            </p>
            {schema.types.map((type) => (
              <details key={type.name}>
                <summary className="link small">{type.name}</summary>
                <div style={{ ...stack, marginTop: 6 }}>
                  <p className="muted small">
                    States: {type.states.join(", ")}
                  </p>
                  <ul style={list}>
                    {type.fields
                      .filter((field) => field.required)
                      .map((field) => (
                        <li key={field.referenceName}>
                          {field.name} · required
                          {field.allowedValues.length
                            ? " · " + field.allowedValues.join(", ")
                            : ""}
                        </li>
                      ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </details>
      )}
      {teams.length > 0 && (
        <Choice
          label="Team"
          options={teams}
          value={team}
          onChange={(id) => {
            pending.current = "";
            restoring.current = undefined;
            remember(id ? { team: id, level: "" } : undefined);
            setStatus("");
            setTeam(id);
            clearBoard();
            if (id) send("options", { team: id });
          }}
        />
      )}
      {schema && team && (
        <AzureWorkReview
          level={level}
          key={team}
          scope={scope}
          context={context}
          schema={schema}
        />
      )}
      {options && (
        <>
          <Choice
            label="Backlog level"
            options={options.levels}
            value={level}
            onChange={(id) => {
              pending.current = "";
              restoring.current = undefined;
              remember({ team, level: id });
              setStatus("");
              setLevel(id);
              setResult(undefined);
            }}
          />
          <div className="row">
            <button
              className="btn"
              disabled={!level}
              onClick={() => {
                setResult(undefined);
                send("cards", { team, level });
              }}
            >
              Show work items
            </button>
          </div>
        </>
      )}
      <p className="muted small" role="status">
        {status}
      </p>
      {result && (
        <>
          <div className="rb-seg" role="group" aria-label="Show work items as">
            <button
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              List view
            </button>
            <button
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
            >
              Board view
            </button>
          </div>
          {view === "list" ? (
            <div className="rb-rows">
              {result.cards.map((c) => (
                <div key={c.id}>
                  <div className="rb-rowitem">
                    <span>
                      <span className="name">
                        #{c.id} {c.title}
                      </span>
                      <br />
                      <span className="muted small">
                        {c.type} · version {c.rev}
                      </span>
                    </span>
                    <span>
                      <span className="tag">{c.state}</span>
                    </span>
                    <span className={c.column ? undefined : "muted"}>
                      {c.column ?? "Unmapped"}
                    </span>
                  </div>
                  <CardEdit
                    scope={scope}
                    level={level}
                    card={c}
                    columns={result.columns}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 16,
                alignItems: "start",
              }}
            >
              {[
                ...result.columns.map((c) => c.name),
                ...(result.cards.some(
                  (c) => !result.columns.some((col) => col.name === c.column),
                )
                  ? [null]
                  : []),
              ].map((col) => (
                <section key={col ?? "unmapped"} style={divided}>
                  <h3>{col ?? "Unmapped"}</h3>
                  <ul style={{ ...list, paddingLeft: 0, listStyle: "none" }}>
                    {result.cards
                      .filter((c) =>
                        col
                          ? c.column === col
                          : !result.columns.some((k) => k.name === c.column),
                      )
                      .map((c) => (
                        <li key={c.id} style={stack}>
                          <span>
                            #{c.id} {c.title}{" "}
                            <span className="tag">{c.state}</span>
                          </span>
                          <CardEdit
                            scope={scope}
                            level={level}
                            card={c}
                            columns={result.columns}
                          />
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {!result.cards.length && (
            <p className="muted">No work items in this team backlog.</p>
          )}
        </>
      )}
    </>
  );
}
