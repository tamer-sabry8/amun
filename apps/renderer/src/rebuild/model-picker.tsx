// The model in use, shown in the prompt box. Pressing it opens the list of
// models the signed-in providers offer (asked from Pi) to choose another.
import { useEffect, useRef, useState } from "react";
import { modelDisplay } from "../../../../packages/domain/src/work/shell.ts";
import { Icon } from "../icons.tsx";
import { useDismiss } from "./use-dismiss.ts";
import { chooseModel, currentModel, listModels } from "./firstmate.ts";

export function ModelPicker({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [problem, setProblem] = useState("");
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setProblem("");
    void listModels().then(setModels);
  }, [open]);
  useDismiss(open, root, () => setOpen(false));
  const current = currentModel();
  const wanted = query.trim().toLowerCase();
  const shown = (models ?? [])
    .filter(
      (model) =>
        !wanted ||
        model.label.toLowerCase().includes(wanted) ||
        model.id.toLowerCase().includes(wanted) ||
        (modelDisplay(model.id)?.toLowerCase().includes(wanted) ?? false),
    )
    // The provider in use first, then by provider and name.
    .sort((a, b) => {
      const provA = a.id.split("/")[0] ?? "";
      const provB = b.id.split("/")[0] ?? "";
      const curProv = current?.split("/")[0] ?? "";
      const mine = (p: string) => (curProv && p === curProv ? 0 : 1);
      return (
        mine(provA) - mine(provB) ||
        provA.localeCompare(provB) ||
        a.label.localeCompare(b.label)
      );
    });
  return (
    <span className="rb-model" ref={root}>
      {open && (
        <div className="rb-menu" role="listbox" aria-label="Choose a model">
          {(models?.length ?? 0) > 8 && (
            <input
              autoFocus
              type="text"
              aria-label="Find a model"
              placeholder="Find a model…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          {models === null ? (
            <p className="muted small">Loading models…</p>
          ) : !models.length ? (
            <p className="muted small">
              Sign in to a provider to choose a model.
            </p>
          ) : !shown.length ? (
            <p className="muted small">No model matches that.</p>
          ) : (
            shown.map((model) => (
              <button
                key={model.id}
                role="option"
                aria-selected={model.id === current}
                onClick={async () => {
                  if (await chooseModel(model.id)) setOpen(false);
                  else
                    setProblem(
                      "That model could not be selected. Try another one.",
                    );
                }}
              >
                <span className="name">{model.label}</span>
                <span className="hint">
                  {modelDisplay(model.id)?.split(" · ")[0]}
                </span>
                {model.id === current && (
                  <Icon name="check" width={14} height={14} strokeWidth={2.4} />
                )}
              </button>
            ))
          )}
          {problem && (
            <p className="small" role="alert">
              {problem}
            </p>
          )}
        </div>
      )}
      <button
        className="routing"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose the model Firstmate uses"
        onClick={() => setOpen(!open)}
      >
        {label}
        <Icon name="chevron" width={11} height={11} />
      </button>
    </span>
  );
}
