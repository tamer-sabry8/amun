import { useReviewOrigin } from "./review-origin.tsx";
import { useEffect, useState } from "react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { currentModel } from "./firstmate.ts";

type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
export function StoryDraftEditor({
  story,
  context,
}: {
  story: Context["storyDrafts"][number];
  context: Context;
}) {
  const origin = useReviewOrigin();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(story.title);
  const [criteria, setCriteria] = useState(story.acceptance.join("\n"));
  const [baseline, setBaseline] = useState({
    title: story.title,
    acceptance: story.acceptance,
  });
  const [submitted, setSubmitted] = useState<{
    title: string;
    acceptance: string[];
  } | null>(null);
  useEffect(() => {
    if (!submitted) return;
    if (
      story.title === submitted.title &&
      JSON.stringify(story.acceptance) === JSON.stringify(submitted.acceptance)
    ) {
      setEditing(false);
      setSubmitted(null);
      return;
    }
    const stop = bridge.onEvent((raw) => {
      if (
        raw &&
        typeof raw === "object" &&
        "kind" in raw &&
        raw.kind === "workspace-error"
      )
        setSubmitted(null);
    });
    const timeout = setTimeout(() => setSubmitted(null), 90000);
    return () => {
      clearTimeout(timeout);
      stop();
    };
  }, [story.title, story.acceptance, submitted]);
  // A product with no allowed models is unrestricted: use Firstmate's.
  const model = context.allowedModels[0] ?? currentModel() ?? "firstmate";
  if (story.status !== "draft") return null;
  if (!editing)
    return (
      <button
        className="btn quiet"
        onClick={() => {
          setTitle(story.title);
          setCriteria(story.acceptance.join("\n"));
          setBaseline({ title: story.title, acceptance: story.acceptance });
          setEditing(true);
        }}
      >
        Edit draft
      </button>
    );
  const reviewed = {
    title: title.trim(),
    acceptance: criteria
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
  return (
    <form
      className="rb-inline"
      onSubmit={(e) => {
        e.preventDefault();
        if (!model || !reviewed.title || !reviewed.acceptance.length) return;
        bridge.send({
          version: 1,
          kind: "product-authoring",
          action: "update-story-draft",
          origin,
          model,
          productId: context.productId,
          objectiveId: story.objectiveId,
          expectedVersion: story.version,
          itemId: story.id,
          baseline,
          reviewed,
        });
        setSubmitted(reviewed);
      }}
    >
      <label className="field">
        Story title
        <input
          value={title}
          maxLength={256}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="field">
        Acceptance criteria · one per line
        <textarea
          value={criteria}
          required
          rows={Math.min(10, Math.max(3, reviewed.acceptance.length))}
          onChange={(e) => setCriteria(e.target.value)}
        />
      </label>
      <div className="row">
        <button
          className="btn primary"
          type="submit"
          disabled={
            !!submitted ||
            !model ||
            !reviewed.title ||
            !reviewed.acceptance.length ||
            reviewed.acceptance.length > 20 ||
            reviewed.acceptance.some((c) => c.length > 2048) ||
            JSON.stringify(reviewed) === JSON.stringify(baseline)
          }
        >
          {submitted ? "Updating…" : "Update draft"}
        </button>
        <button
          className="btn quiet"
          type="button"
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
