import { useEffect, useRef, useState } from "react";

/** A read-only side-by-side comparison of one changed file. */
export function PullDiff({
  value,
}: {
  value: { before: string; after: string };
}) {
  const host = useRef<HTMLDivElement>(null);
  const [regions, count] = useState<number | null>(null);
  useEffect(() => {
    if (!host.current) return;
    globalThis.MonacoEnvironment = {
      getWorker: () =>
        new Worker(new URL("./diff-worker.js", document.baseURI)),
    };
    count(null);
    let disposed = false;
    let release: (() => void) | undefined;
    void import("monaco-editor/editor/editor.api.js").then(({ editor }) => {
      if (disposed) return;
      const before = editor.createModel(value.before, "plaintext"),
        after = editor.createModel(value.after, "plaintext");
      const view = editor.createDiffEditor(host.current!, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        minimap: { enabled: false },
        renderSideBySide: true,
      });
      const observer = view.onDidUpdateDiff(() =>
        count(view.getLineChanges()?.length ?? null),
      );
      view.setModel({ original: before, modified: after });
      release = () => {
        observer.dispose();
        view.dispose();
        before.dispose();
        after.dispose();
      };
    });
    return () => {
      disposed = true;
      release?.();
    };
  }, [value]);
  return (
    <>
      <p aria-label="Diff summary" aria-live="polite">
        {regions === null
          ? "Comparing…"
          : regions + " changed " + (regions === 1 ? "region" : "regions")}
      </p>
      <div className="pull-diff" aria-label="File comparison" ref={host} />
    </>
  );
}
