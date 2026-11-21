import type { WorkspaceSnapshot } from "@amun/contracts";
import { PrdCoverage } from "./prd-coverage.tsx";
import { StoryDraftEditor } from "./story-draft-editor.tsx";
export function StoryProposals({
  context,
  objectiveId,
  version,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
  objectiveId: string;
  version: number;
}) {
  return (
    <section aria-label="Story proposals">
      <h3>Story proposals</h3>
      <PrdCoverage
        context={context}
        objectiveId={objectiveId}
        version={version}
      />
      {context.storyDrafts
        .filter(
          (s) =>
            s.objectiveId === objectiveId &&
            s.version === version &&
            !s.parentId,
        )
        .map((story) => (
          <article className="rb-inline" key={story.id}>
            <h4>{story.title}</h4>
            <p className="muted small">
              PRD v{story.version} · {story.requirement}
            </p>
            <ul>
              {story.acceptance.map((criterion, i) => (
                <li key={i}>{criterion}</li>
              ))}
            </ul>
            <StoryDraftEditor context={context} story={story} />
          </article>
        ))}
    </section>
  );
}
