import { useEffect, useRef, useState } from "react";
import { previewResult } from "@amun/contracts";
import { bridge } from "../bridge.ts";

export interface WireframeSummary {
  id: string;
  title: string;
  version: number;
}

/**
 * Once a PRD is approved: ask Firstmate to have a specialist produce a
 * clickable wireframe in the Library, or open the latest saved wireframe
 * directly in the isolated offline preview pane.
 */
export function PrototypeCard({
  revision,
  areaId,
  latestWireframe,
  onAsk,
  open,
}: {
  revision: number;
  areaId?: string | undefined;
  latestWireframe?: WireframeSummary | null | undefined;
  onAsk?: ((prompt: string) => void) | undefined;
  open: (
    url: string,
    meta?: { outputId: string; title: string; version: number },
  ) => void;
}) {
  const waiting = useRef<{
    id: string;
    outputId: string;
    title: string;
    version: number;
  } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      bridge.onEvent((raw) => {
        const result = previewResult.safeParse(raw);
        if (!result.success || result.data.id !== waiting.current?.id) return;
        const pending = waiting.current;
        waiting.current = null;
        setBusy(false);
        setStatus(result.data.url ? "" : result.data.message);
        if (result.data.url && pending) {
          open(result.data.url, {
            outputId: pending.outputId,
            title: result.data.title ?? pending.title,
            version: result.data.version ?? pending.version,
          });
        }
      }),
    [open],
  );

  const openLatest = () => {
    if (!latestWireframe) return;
    const id = crypto.randomUUID();
    waiting.current = {
      id,
      outputId: latestWireframe.id,
      title: latestWireframe.title,
      version: latestWireframe.version,
    };
    setBusy(true);
    setStatus("");
    bridge.send({
      version: 1,
      kind: "output-preview",
      id,
      outputId: latestWireframe.id,
      ...(areaId ? { areaId } : {}),
    });
  };

  return (
    <section className="rb-inline" aria-label="Wireframe">
      <h3>Wireframe</h3>
      <div className="row wrap">
        <button
          type="button"
          className="btn"
          disabled={!onAsk}
          onClick={() =>
            onAsk?.(
              `Ask a specialist to build a self-contained clickable HTML wireframe from approved PRD v${revision} using synthetic data only, and save it to our Library as a prototype.`,
            )
          }
        >
          Ask Firstmate for a wireframe
        </button>
        {latestWireframe && (
          <button
            type="button"
            className="btn quiet"
            disabled={busy}
            onClick={openLatest}
          >
            Open latest wireframe (v{latestWireframe.version})
          </button>
        )}
      </div>
      <p className="note" role="status">
        {busy
          ? "Opening the preview…"
          : status ||
            `Firstmate asks a specialist to build a clickable wireframe from PRD v${revision} and saves it in your Library.`}
      </p>
    </section>
  );
}
