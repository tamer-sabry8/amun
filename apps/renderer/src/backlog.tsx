import { AzureWorkReview, CardEdit } from "./azure-work-review.tsx";
import { DecisionReview } from "./story-decisions.tsx";
import { useState, useEffect, useRef } from "react";
import {
  backlogResult,
  type BacklogResult,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import { bridge } from "./bridge.ts";
type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
type Option = { id: string; name: string };
function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Backlog({ context }: { context: Context }) {
  const sources = context.sources.filter((s) => s.kind === "ado");
  const [sourceId, setSource] = useState("");
  return (
    <section aria-label="Azure DevOps backlog">
      <h2>Backlog</h2>
      {context.storyDrafts.length > 0 && (
        <section aria-label="Story drafts">
          <h3>Proposed stories</h3>
          {context.storyDrafts
            .filter((d) => !d.parentId)
            .map((story) => (
              <article key={story.id}>
                <h4>{story.title}</h4>
                <p>
                  PRD v{story.version} · {story.requirementId}
                </p>
                <blockquote>{story.requirement}</blockquote>
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
                  <button
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
                )}
                <ul>
                  {story.acceptance.map((criterion, i) => (
                    <li key={i}>{criterion}</li>
                  ))}
                </ul>
                <ul>
                  {context.storyDrafts
                    .filter((d) => d.parentId === story.id)
                    .map((task) => (
                      <li key={task.id}>{task.title}</li>
                    ))}
                </ul>
              </article>
            ))}
        </section>
      )}

      {sources.length ? (
        <>
          <Choice
            label="Azure project"
            options={sources.map((s) => ({ id: s.id, name: s.title }))}
            value={sourceId}
            onChange={setSource}
          />
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
        <p>
          Map an Azure DevOps project URL in Product context to open its
          backlog.
        </p>
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
          setStatus("Connection interrupted. Reload teams to retry.");
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
        if (reply.view === "teams") setTeams(reply.teams);
        if (reply.view === "options") setOptions(reply);
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
  return (
    <>
      <button
        onClick={() => {
          setTeams([]);
          setTeam("");
          clearBoard();
          send("teams");
        }}
      >
        Load teams
      </button>
      <button onClick={() => send("schema")}>Load process details</button>
      {schema && (
        <details open>
          <summary>{schema.process ?? "Project process"}</summary>
          <p>Area paths: {schema.areas.join(", ")}</p>
          <p>Iteration paths: {schema.iterations.join(", ")}</p>
          {schema.types.map((type) => (
            <details key={type.name}>
              <summary>{type.name}</summary>
              <p>States: {type.states.join(", ")}</p>
              <ul>
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
            </details>
          ))}
        </details>
      )}
      {teams.length > 0 && (
        <Choice
          label="Azure team"
          options={teams}
          value={team}
          onChange={(id) => {
            pending.current = "";
            setStatus("");
            setTeam(id);
            clearBoard();
            if (id) send("options", { team: id });
          }}
        />
      )}
      {schema && team && (
        <AzureWorkReview
          key={team}
          scope={{ productId, sourceId, team }}
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
              setStatus("");
              setLevel(id);
              setResult(undefined);
            }}
          />
          <button
            disabled={!level}
            onClick={() => {
              setResult(undefined);
              send("cards", { team, level });
            }}
          >
            Load work items
          </button>
        </>
      )}
      <p role="status">{status}</p>
      {result && (
        <>
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
          {view === "list" ? (
            <table>
              <thead>
                <tr>
                  {["ID", "Title", "Type", "State", "Column", "Revision"].map(
                    (x) => (
                      <th key={x}>{x}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {result.cards.map((c) => (
                  <tr key={c.id}>
                    {[
                      c.id,
                      c.title,
                      c.type,
                      c.state,
                      c.column ?? "Unmapped",
                      c.rev,
                    ].map((v, i) => (
                      <td key={i}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="backlog-columns">
              {[
                ...result.columns.map((c) => c.name),
                ...(result.cards.some(
                  (c) => !result.columns.some((col) => col.name === c.column),
                )
                  ? [null]
                  : []),
              ].map((col) => (
                <section key={col ?? "unmapped"}>
                  <h3>{col ?? "Unmapped"}</h3>
                  <ul>
                    {result.cards
                      .filter((c) =>
                        col
                          ? c.column === col
                          : !result.columns.some((k) => k.name === c.column),
                      )
                      .map((c) => (
                        <li key={c.id}>
                          #{c.id} {c.title} · {c.state}
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {result.cards.map((c) => (
            <CardEdit
              key={c.id}
              scope={{ productId, sourceId, team }}
              level={level}
              card={c}
              columns={result.columns}
            />
          ))}
          {!result.cards.length && <p>No work items in this team backlog.</p>}
        </>
      )}
    </>
  );
}
