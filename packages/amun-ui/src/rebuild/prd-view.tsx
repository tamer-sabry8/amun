import { useReviewOrigin } from "./review-origin.tsx";
import { StoryProposals } from "./story-proposals.tsx";
// The PRD pane. Same messages and checks as the earlier PRD workspace
// (understanding, editor with autosave, Firstmate proposals, approval, stories,
// selection tools); only the view is new. The earlier Research / Write /
// Review modes are one page here, so nothing is hidden behind a mode.
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { currentModel } from "./firstmate.ts";
import { parsePrd, prdExtensions, writePrd } from "../prd-markdown.ts";
import { PrototypeCard, type WireframeSummary } from "./prototype-card.tsx";
import { code, list, Problem, stack } from "./view-parts.tsx";

type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
type Objective = Context["objectives"][number];
const send = (action: string, fields: Record<string, unknown>) =>
  bridge.send({ version: 1, kind: "workspace", action, ...fields });
const nothing = () => undefined;

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
    <pre aria-label="What would change" style={code}>
      {a.slice(0, start).join("\n")}
      {"\n"}
      <del style={{ color: "var(--amun-status-error)" }}>
        {a.slice(start, a.length - end).join("\n")}
      </del>
      {"\n"}
      <ins
        style={{
          color: "var(--amun-status-connected)",
          textDecoration: "none",
        }}
      >
        {b.slice(start, b.length - end).join("\n")}
      </ins>
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
    <section className="rb-inline" aria-label="Product understanding">
      <h3>Product understanding</h3>
      <p>{objective.question}</p>
      <p className={objective.answer ? undefined : "muted"}>
        {objective.answer ?? "Answer the interview in Requests."}
      </p>
      {objective.answer && (
        <>
          <label className="field">
            Facts
            <textarea
              aria-label="Facts"
              style={{ minHeight: 96, resize: "vertical" }}
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
            />
          </label>
          <label className="field">
            Assumptions
            <textarea
              aria-label="Assumptions"
              style={{ minHeight: 96, resize: "vertical" }}
              value={assumptions}
              onChange={(e) => setAssumptions(e.target.value)}
            />
          </label>
          <label className="field">
            Open questions
            <textarea
              aria-label="Open questions"
              style={{ minHeight: 96, resize: "vertical" }}
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
            />
          </label>
          <div className="row wrap">
            <button
              className="btn"
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
              className="btn"
              disabled={!saved || u?.approved}
              onClick={() => send("approve-understanding", target)}
            >
              Approve understanding
            </button>
            {u && (
              <span className="row" role="status">
                <span className={"tag" + (u.approved ? " good" : "")}>
                  {u.approved ? "Approved" : "Draft"}
                </span>
                <span className="muted small">Version {u.version}</span>
              </span>
            )}
          </div>
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
  return (
    <div
      className="rb-doc-view"
      style={{
        minHeight: "14rem",
        padding: 10,
        border: "1px solid var(--control)",
        borderRadius: 8,
        background: "var(--canvas)",
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
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
  const picker = useRef<HTMLInputElement>(null);
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
    <section
      className="rb-inline"
      aria-label="PRD"
      style={{ maxWidth: "none" }}
      onBlur={flush}
    >
      <div className="row wrap">
        <h3 className="grow">PRD</h3>
        <button className="btn" onClick={convert}>
          {visual ? "Edit as text" : "Edit as a document"}
        </button>
      </div>
      <Problem>{warning}</Problem>
      {visual ? (
        <VisualEditor
          key={generation}
          initial={draft}
          onEdit={edit}
          onSelect={onSelection}
        />
      ) : (
        <label className="field">
          Text of the PRD
          <textarea
            aria-label="Text of the PRD"
            className="prd-body"
            style={{ minHeight: "14rem", resize: "vertical" }}
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
      <p className="muted small" role="status">
        {conflict
          ? ""
          : draft === prd?.markdown
            ? "Saved v" + prd.version
            : draft.trim()
              ? "Saving changes…"
              : "Enter a draft or generate one from the objective."}
      </p>
      {conflict && (
        <>
          <p role="alert" className="small">
            The saved version changed. Your draft is retained.
          </p>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                setConflict(false);
                setDraft(saved.current.text);
                latest.current = saved.current.text;
                resetVisual((n) => n + 1);
              }}
            >
              Use latest saved version
            </button>
          </div>
        </>
      )}
      <div className="row wrap">
        <button className="btn" onClick={() => picker.current?.click()}>
          Import a file
        </button>
        <input
          ref={picker}
          className="sr-only"
          type="file"
          tabIndex={-1}
          aria-label="Add a source document"
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
        <button
          className="btn"
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
          Download a copy
        </button>
      </div>
      {prd && (
        <details>
          <summary className="link small">
            Earlier versions ({prd.history.length})
          </summary>
          <div style={{ ...stack, marginTop: 8 }}>
            {prd.history.map((v) => (
              <details key={v.version}>
                <summary className="link small">Version {v.version}</summary>
                <pre style={{ ...code, marginTop: 6 }}>{v.markdown}</pre>
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

export function PrdView({
  initialObjective,
  context,
  openPreview,
  onAskWireframe,
  latestWireframe,
}: {
  context: Context;
  openPreview?:
    | ((
        url: string,
        meta?: { outputId: string; title: string; version: number },
      ) => void)
    | undefined;
  onAskWireframe?: ((prompt: string) => void) | undefined;
  latestWireframe?: WireframeSummary | null | undefined;
  initialObjective?: string | undefined;
}) {
  const origin = useReviewOrigin();
  const difficulty = "standard";
  const [chosen, choose] = useState(initialObjective ?? ""),
    [selection, select] = useState(""),
    [asked, setAsked] = useState(false),
    [sourcesOpen, setSourcesOpen] = useState(false);
  // A product with no allowed models is unrestricted: use Firstmate's.
  const model = context.allowedModels[0] ?? currentModel() ?? "firstmate";
  const objective =
    context.objectives.find((o) => o.id === chosen) ?? context.objectives[0];
  if (!objective)
    return (
      <p className="muted" role="status">
        No PRD yet. Ask Firstmate in this project’s conversation to write one,
        and it will appear here.
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
      difficulty,
      understandingVersion: u?.version,
      selection: passage,
    });
    setAsked(true);
  };
  const storiesReady =
    prd &&
    context.storyDrafts.some(
      (d) => d.objectiveId === objective.id && d.version === prd.version,
    );
  return (
    <div style={{ ...stack, gap: 14, maxWidth: "72ch" }}>
      <label className="field">
        Objective
        <select
          value={objective.id}
          onChange={(e) => {
            choose(e.target.value);
            select("");
            setAsked(false);
          }}
        >
          {context.objectives.map((o) => (
            <option value={o.id} key={o.id}>
              {o.statement}
            </option>
          ))}
        </select>
      </label>
      {prd && (
        <p className="row wrap" role="status" aria-label="PRD approval status">
          <span className={"tag" + (prd.approved ? " good" : "")}>
            {prd.approved
              ? "Approved PRD v" + prd.version
              : "Draft PRD v" + prd.version}
          </span>
          {prd.invalidated && (
            <span className="muted small">{prd.invalidated}</span>
          )}
        </p>
      )}
      {proposal && (
        <section className="rb-inline amber" aria-label="Firstmate proposal">
          <h3>Firstmate suggests a change</h3>
          <p>{proposal.rationale}</p>
          <ProposalDiff
            before={prd?.markdown ?? ""}
            after={proposal.markdown}
          />
          <div className="row wrap">
            <button
              className="btn"
              onClick={() =>
                send("apply-proposal", { ...target, proposalId: proposal.id })
              }
            >
              Apply proposal
            </button>
            <button
              className="btn quiet"
              onClick={() =>
                send("dismiss-proposal", { ...target, proposalId: proposal.id })
              }
            >
              Dismiss proposal
            </button>
          </div>
        </section>
      )}
      {prd?.approved && (
        <PrototypeCard
          key={objective.id + prd.version}
          revision={prd.version}
          areaId={origin?.areaId}
          latestWireframe={latestWireframe}
          onAsk={onAskWireframe}
          open={openPreview ?? nothing}
        />
      )}
      <Understanding
        key={"understanding:" + objective.id}
        objective={objective}
        productId={context.productId}
      />
      <div style={stack}>
        <div className="row wrap">
          <button
            className="btn"
            disabled={!u?.approved || !model}
            onClick={() => generate("draft")}
          >
            Draft PRD from objective
          </button>
          {prd && (
            <button
              className="btn"
              disabled={!u?.approved || !model || !!proposal}
              onClick={() => generate("critique")}
            >
              Ask Firstmate for critique
            </button>
          )}
        </div>
        {!u?.approved && (
          <p className="muted small">
            Approve the product understanding first, then Firstmate can draft
            the PRD.
          </p>
        )}
        <p className="muted small" role="status">
          {asked
            ? "Firstmate is working on it. Its suggestion will appear here."
            : ""}
        </p>
      </div>
      <PrdEditor
        key={"editor:" + objective.id}
        objective={objective}
        productId={context.productId}
        onSelection={select}
      />
      {selection && (
        <aside className="rb-inline" aria-label="Selection tools">
          <p className="muted small">
            Selected: “
            {selection.length > 120 ? selection.slice(0, 120) + "…" : selection}
            ”
          </p>
          <div className="row wrap">
            <button
              className="btn"
              disabled={!u?.approved || !model}
              onClick={() => generate("critique", selection)}
            >
              Ask Firstmate about selection
            </button>
            {(
              [
                ["link", "Link requirement"],
                ["story", "Make a draft story"],
                ["assumption", "Mark as an assumption"],
                ["source", "Ask for a source"],
              ] as const
            ).map(([intent, label]) => (
              <button
                className="btn"
                key={intent}
                disabled={!prd?.markdown.includes(selection)}
                onClick={() =>
                  send("prd-selection", { ...target, selection, intent })
                }
              >
                {label}
              </button>
            ))}
            <button className="btn quiet" onClick={() => setSourcesOpen(true)}>
              Review sources
            </button>
          </div>
        </aside>
      )}
      {prd && (
        <section className="rb-inline" aria-label="Approve and plan stories">
          <h3>Review PRD v{prd.version}</h3>
          <details>
            <summary className="link small">Read the saved version</summary>
            <pre style={{ ...code, marginTop: 6 }}>{prd.markdown}</pre>
          </details>
          <div className="row wrap">
            <button
              className="btn"
              disabled={prd.approved || !!proposal}
              onClick={() =>
                send("approve-prd", { ...target, markdown: prd.markdown })
              }
            >
              Approve PRD v{prd.version}
            </button>
            <button
              className="btn"
              disabled={!prd.approved || !model || !!storiesReady}
              onClick={() =>
                bridge.send({
                  version: 1,
                  kind: "product-authoring",
                  ...target,
                  action: "stories",
                  origin,
                  model,
                  difficulty,
                })
              }
            >
              Generate stories
            </button>
          </div>
          {storiesReady && (
            <StoryProposals
              context={context}
              objectiveId={objective.id}
              version={prd.version}
            />
          )}
        </section>
      )}
      {objective.links.length > 0 && (
        <details>
          <summary className="link small">
            Linked work and annotations ({objective.links.length})
          </summary>
          <ul style={{ ...list, marginTop: 6 }}>
            {objective.links.map((link) => (
              <li key={link.id}>
                v{link.version} · {link.intent} · {link.selection} ·{" "}
                {link.target}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details
        open={sourcesOpen}
        onToggle={(e) => setSourcesOpen(e.currentTarget.open)}
      >
        <summary className="link small">
          Sources ({context.sources.length})
        </summary>
        <ul style={{ ...list, marginTop: 6 }}>
          {context.sources.map((s) => (
            <li key={s.id}>{s.title}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
