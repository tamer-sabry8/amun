import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";
import { parsePrd, prdExtensions, writePrd } from "./prd-markdown.ts";
type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
type Objective = Context["objectives"][number];
const send = (action: string, fields: Record<string, unknown>) =>
  bridge.send({ version: 1, kind: "workspace", action, ...fields });

function ProposalDiff({ before, after }: { before: string; after: string }) {
  const a = before.split("\n"),
    b = after.split("\n");
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return (
    <pre className="prd-diff">
      {a.slice(0, start).join("\n")}
      {"\n"}
      <del>{a.slice(start, a.length - end).join("\n")}</del>
      {"\n"}
      <ins>{b.slice(start, b.length - end).join("\n")}</ins>
      {"\n"}
      {b.slice(b.length - end).join("\n")}
    </pre>
  );
}
function Understanding({
  objective,
  productId,
}: {
  objective: Objective;
  productId: string;
}) {
  const u = objective.understanding;
  const [facts, setFacts] = useState(u?.facts ?? objective.answer ?? "");
  const [assumptions, setAssumptions] = useState(u?.assumptions ?? "");
  const [questions, setQuestions] = useState(u?.questions ?? "");
  const target = {
    productId,
    objectiveId: objective.id,
    expectedVersion: u?.version ?? 0,
  };
  const saved = Boolean(
    u &&
    u.facts === facts &&
    u.assumptions === assumptions &&
    u.questions === questions,
  );
  return (
    <section>
      <h3>Product understanding</h3>
      <p>{objective.question}</p>
      <p>{objective.answer ?? "Answer the interview in Requests."}</p>
      {objective.answer && (
        <>
          <label>
            Facts
            <textarea
              aria-label="Facts"
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
            />
          </label>
          <label>
            Assumptions
            <textarea
              aria-label="Assumptions"
              value={assumptions}
              onChange={(e) => setAssumptions(e.target.value)}
            />
          </label>
          <label>
            Open questions
            <textarea
              aria-label="Open questions"
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
            />
          </label>
          <button
            disabled={saved || !facts.trim()}
            onClick={() =>
              send("save-understanding", {
                ...target,
                facts,
                assumptions,
                questions,
              })
            }
          >
            Save understanding
          </button>
          <button
            disabled={!saved || u?.approved}
            onClick={() => send("approve-understanding", target)}
          >
            Approve understanding
          </button>
          {u && (
            <p>
              Understanding v{u.version} · {u.approved ? "Approved" : "Draft"}
            </p>
          )}
        </>
      )}
    </section>
  );
}
function VisualEditor({
  initial,
  onEdit,
  onSelect,
}: {
  initial: string;
  onEdit: (md: string) => void;
  onSelect: (text: string) => void;
}) {
  const editor = useEditor({
    extensions: prdExtensions,
    content: parsePrd(initial).doc,
    editorProps: {
      attributes: { "aria-label": "Visual PRD editor", role: "textbox" },
    },
    onUpdate: ({ editor }) => onEdit(writePrd(editor.getJSON())),
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      onSelect(editor.state.doc.textBetween(from, to, "\n").slice(0, 4096));
    },
  });
  return <EditorContent editor={editor} />;
}
function PrdEditor({
  objective,
  productId,
  onSelection,
}: {
  objective: Objective;
  productId: string;
  onSelection: (s: string) => void;
}) {
  const prd = objective.prd;
  const [draft, setDraft] = useState(prd?.markdown ?? "");
  const [visual, setVisual] = useState(false);
  const [generation, resetVisual] = useState(0);
  const [warning, setWarning] = useState("");
  const [conflict, setConflict] = useState(false);
  const saved = useRef({
    text: prd?.markdown ?? "",
    version: prd?.version ?? 0,
  });
  const pending = useRef<string | null>(null),
    latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = () => {
    clearTimeout(timer.current);
    if (
      conflict ||
      pending.current !== null ||
      !latest.current.trim() ||
      latest.current === saved.current.text
    )
      return;
    pending.current = latest.current;
    send("save-prd", {
      objectiveId: objective.id,
      productId,
      expectedVersion: saved.current.version,
      markdown: latest.current,
    });
  };
  const edit = (value: string) => {
    latest.current = value;
    setDraft(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 450);
  };
  useEffect(() => {
    if (!prd || prd.version === saved.current.version) return;
    const clean = latest.current === saved.current.text;
    const ack = pending.current === prd.markdown;
    saved.current = { text: prd.markdown, version: prd.version };
    pending.current = null;
    if (clean) {
      latest.current = prd.markdown;
      setDraft(prd.markdown);
      resetVisual((n) => n + 1);
    } else if (ack) flush();
    else {
      clearTimeout(timer.current);
      setConflict(true);
    }
  }, [prd?.version]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const convert = () => {
    if (!visual) {
      const parsed = parsePrd(draft);
      if (parsed.warnings.length) {
        setWarning(parsed.warnings[0]!);
        return;
      }
    }
    setWarning("");
    setVisual(!visual);
    onSelection("");
  };
  return (
    <section onBlur={flush}>
      <h3>PRD editor</h3>
      <button onClick={convert}>
        {visual ? "Markdown mode" : "Visual mode"}
      </button>
      {warning && <p role="alert">{warning}</p>}
      {visual ? (
        <VisualEditor
          key={generation}
          initial={draft}
          onEdit={edit}
          onSelect={onSelection}
        />
      ) : (
        <label>
          PRD Markdown
          <textarea
            aria-label="PRD Markdown"
            className="prd-body"
            value={draft}
            onChange={(e) => edit(e.target.value)}
            onSelect={(e) =>
              onSelection(
                draft
                  .slice(
                    e.currentTarget.selectionStart,
                    e.currentTarget.selectionEnd,
                  )
                  .slice(0, 4096),
              )
            }
          />
        </label>
      )}
      <p>
        {conflict
          ? "The saved version changed. Your draft is retained."
          : draft === prd?.markdown
            ? "Saved v" + prd.version
            : draft.trim()
              ? "Saving changes…"
              : "Enter a draft or generate one from the objective."}
      </p>
      {conflict && (
        <button
          onClick={() => {
            setConflict(false);
            setDraft(saved.current.text);
            latest.current = saved.current.text;
            resetVisual((n) => n + 1);
          }}
        >
          Use latest saved version
        </button>
      )}
      <label>
        Import PRD Markdown
        <input
          type="file"
          accept=".md,.markdown,.txt"
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!f) return;
            if (f.size > 100000) {
              setWarning("Choose a Markdown file up to 100 KB.");
              return;
            }
            const value = await f.text();
            setVisual(false);
            setWarning(parsePrd(value).warnings.join(" "));
            edit(value);
          }}
        />
      </label>
      <button
        disabled={!draft}
        onClick={() => {
          const link = document.createElement("a");
          const url = URL.createObjectURL(
            new Blob([draft], { type: "text/markdown" }),
          );
          link.href = url;
          link.download = "PRD-v" + (prd?.version ?? 0) + ".md";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }}
      >
        Export Markdown
      </button>
      {prd && (
        <details>
          <summary>Version history ({prd.history.length})</summary>
          {prd.history.map((v) => (
            <details key={v.version}>
              <summary>Version {v.version}</summary>
              <pre>{v.markdown}</pre>
            </details>
          ))}
        </details>
      )}
    </section>
  );
}
export function PrdWorkspace({
  context,
  mode,
  setMode,
}: {
  context: Context;
  mode: string;
  setMode: (s: string) => void;
}) {
  const [chosen, choose] = useState(""),
    [selection, select] = useState(""),
    [model, chooseModel] = useState(context.allowedModels[0] ?? "");
  const objective =
    context.objectives.find((o) => o.id === chosen) ?? context.objectives[0];
  if (!objective)
    return (
      <p>
        Start a Firstmate interview from the product overview to create an
        objective.
      </p>
    );
  const { prd, proposal, understanding: u } = objective;
  const target = {
    productId: context.productId,
    objectiveId: objective.id,
    expectedVersion: prd?.version ?? 0,
  };
  const generate = (action: "draft" | "critique", passage = "") => {
    bridge.send({
      version: 1,
      kind: "product-authoring",
      ...target,
      action,
      model,
      understandingVersion: u?.version,
      selection: passage,
    });
    setMode("Review");
  };
  const sourceList = (
    <ul>
      {context.sources.map((s) => (
        <li key={s.id}>
          {s.title} <small>{s.id}</small>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="prd-workflow">
      <label>
        Objective
        <select
          value={objective.id}
          onChange={(e) => {
            choose(e.target.value);
            select("");
          }}
        >
          {context.objectives.map((o) => (
            <option value={o.id} key={o.id}>
              {o.statement}
            </option>
          ))}
        </select>
      </label>
      <label>
        Firstmate model
        <select value={model} onChange={(e) => chooseModel(e.target.value)}>
          {context.allowedModels.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      {prd && (
        <p aria-label="PRD approval status">
          {prd.approved
            ? "Approved PRD v" + prd.version
            : "Draft PRD v" + prd.version}
          {prd.invalidated ? " · " + prd.invalidated : ""}
        </p>
      )}
      {mode === "Research" ? (
        <>
          {sourceList}
          <Understanding
            key={objective.id}
            objective={objective}
            productId={context.productId}
          />
        </>
      ) : mode === "Review" ? (
        <>
          {proposal && (
            <section>
              <h3>Firstmate proposal</h3>
              <p>{proposal.rationale}</p>
              <ProposalDiff
                before={prd?.markdown ?? ""}
                after={proposal.markdown}
              />
              <button
                onClick={() =>
                  send("apply-proposal", { ...target, proposalId: proposal.id })
                }
              >
                Apply proposal
              </button>
              <button
                onClick={() =>
                  send("dismiss-proposal", {
                    ...target,
                    proposalId: proposal.id,
                  })
                }
              >
                Dismiss proposal
              </button>
            </section>
          )}
          {prd && (
            <>
              <button
                disabled={
                  !prd.approved ||
                  !model ||
                  context.storyDrafts.some(
                    (d) =>
                      d.objectiveId === objective.id &&
                      d.version === prd.version,
                  )
                }
                onClick={() =>
                  bridge.send({
                    version: 1,
                    kind: "product-authoring",
                    ...target,
                    action: "stories",
                    model,
                  })
                }
              >
                Generate stories
              </button>
              {context.storyDrafts.some(
                (d) =>
                  d.objectiveId === objective.id && d.version === prd.version,
              ) && <p role="status">Story drafts ready in Backlog.</p>}
              <h3>Review PRD v{prd.version}</h3>
              <pre>{prd.markdown}</pre>
              <button
                disabled={prd.approved || !!proposal}
                onClick={() =>
                  send("approve-prd", { ...target, markdown: prd.markdown })
                }
              >
                Approve PRD v{prd.version}
              </button>
            </>
          )}
          <button
            disabled={!u?.approved || !model || !!proposal}
            onClick={() => generate(prd ? "critique" : "draft")}
          >
            {prd ? "Ask Firstmate for critique" : "Draft PRD from objective"}
          </button>
        </>
      ) : (
        <>
          <Understanding
            key={objective.id}
            objective={objective}
            productId={context.productId}
          />
          <button
            disabled={!u?.approved || !model}
            onClick={() => generate("draft")}
          >
            Draft PRD from objective
          </button>
          <PrdEditor
            key={objective.id}
            objective={objective}
            productId={context.productId}
            onSelection={select}
          />
          {objective.links.length > 0 && (
            <details>
              <summary>
                Linked work and annotations ({objective.links.length})
              </summary>
              <ul>
                {objective.links.map((link) => (
                  <li key={link.id}>
                    v{link.version} · {link.intent} · {link.selection} ·{" "}
                    {link.target}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {selection && (
            <aside aria-label="Selection tools">
              <button
                disabled={!u?.approved || !model}
                onClick={() => generate("critique", selection)}
              >
                Ask Firstmate about selection
              </button>
              {(
                [
                  ["link", "Link requirement"],
                  ["story", "Create local draft story"],
                  ["assumption", "Mark assumption"],
                  ["source", "Request source"],
                ] as const
              ).map(([intent, label]) => (
                <button
                  key={intent}
                  disabled={!prd?.markdown.includes(selection)}
                  onClick={() =>
                    send("prd-selection", { ...target, selection, intent })
                  }
                >
                  {label}
                </button>
              ))}
              <button onClick={() => setMode("Research")}>
                Review sources
              </button>
            </aside>
          )}
        </>
      )}
    </div>
  );
}
