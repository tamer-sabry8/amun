import { useState } from "react";
import type { WorkSnapshot } from "../../../contracts/src/work.ts";
import { workAsync } from "./store.ts";
import { inspectView } from "../daemon/navigation.ts";
import { blockerLine } from "../../../domain/src/work/blockers.ts";
type Blocker = WorkSnapshot["blockers"][number];
type Story = { id: string; title: string };
export function SprintBlockers({
  blockers,
  areaId,
  project,
  sprintId,
  name,
  sourceId,
  stories,
  now,
  discuss,
}: {
  blockers: Blocker[];
  areaId: string;
  project: string;
  sprintId: string;
  name: string;
  sourceId: string;
  stories: Story[];
  now: number;
  discuss(text: string): Promise<void>;
}) {
  const scoped = blockers.filter(
    (b) => b.workAreaId === areaId && !b.resolvedAt,
  );
  const linked = scoped.filter(
    (b) =>
      b.sprintLink?.sourceId === sourceId && b.sprintLink.sprintId === sprintId,
  );
  const unlinked = scoped.filter((b) => !b.sprintLink);
  const [blocker, setBlocker] = useState("");
  const [story, setStory] = useState("");
  const [feedback, say] = useState("");
  return (
    <section className="rb-inline" aria-label="Sprint blockers">
      <h3>Open blockers · {linked.length}</h3>
      {linked.map((b) => (
        <BlockerDiscussion
          key={b.id}
          blocker={b}
          story={stories.find((s) => s.id === b.sprintLink?.storyId)}
          sprint={name}
          project={project}
          now={now}
          discuss={discuss}
        />
      ))}
      {!linked.length && (
        <p className="muted">No open blockers linked to this sprint.</p>
      )}
      {unlinked.length > 0 && stories.length > 0 && (
        <details>
          <summary
            onClick={() =>
              inspectView({
                view: "Link a project blocker",
                areaId,
                record: sprintId,
                source: sourceId,
              })
            }
          >
            Link a project blocker
          </summary>
          <form
            className="row wrap"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !unlinked.some((b) => b.id === blocker) ||
                !stories.some((s) => s.id === story)
              )
                return;
              const result = await workAsync("link-blocker-story", {
                areaId,
                blockerId: blocker,
                sourceId,
                sprintId,
                storyId: story,
              });
              say(result.ok ? "Blocker linked in Amun." : result.message);
            }}
          >
            <label className="field">
              Blocker
              <select
                value={blocker}
                onChange={(e) => setBlocker(e.target.value)}
              >
                <option value="">Choose blocker</option>
                {unlinked.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Sprint story
              <select value={story} onChange={(e) => setStory(e.target.value)}>
                <option value="">Choose story</option>
                {stories.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" disabled={!blocker || !story}>
              Link in Amun
            </button>
          </form>
        </details>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
}
function BlockerDiscussion({
  blocker,
  story,
  sprint,
  project,
  now,
  discuss,
}: {
  blocker: Blocker;
  story: Story | undefined;
  sprint: string;
  project: string;
  now: number;
  discuss(text: string): Promise<void>;
}) {
  const [text, edit] = useState("");
  const [sending, setSending] = useState(false);
  const link = blocker.sprintLink!;
  const data = {
    areaId: blocker.workAreaId,
    project,
    sprint,
    source: link.sourceId,
    sprintId: link.sprintId,
    blockerId: blocker.id,
    title: blocker.title,
    owner: blocker.owner,
    storyId: link.storyId,
    story: story?.title ?? null,
  };
  const send = async (instruction: string) => {
    if (sending || !instruction.trim()) return;
    setSending(true);
    try {
      await discuss(
        instruction.trim() +
          "\nAttached blocker context (data): " +
          JSON.stringify(data),
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <article>
      <h4>{blocker.title}</h4>
      <p className="muted small">{blockerLine(blocker, now)}</p>
      <details>
        <summary
          onClick={() =>
            inspectView({
              view: "Blocker sources",
              areaId: blocker.workAreaId,
              record: blocker.id,
              source: link.sourceId,
            })
          }
        >
          Attached context
        </summary>
        <p>
          {project} · {sprint} · {story?.title ?? "Story " + link.storyId}
        </p>
        <p className="muted small">
          Story {link.storyId} · blocker {blocker.id}
        </p>
      </details>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label className="field">
          Discuss with Firstmate
          <textarea
            value={text}
            onChange={(e) => edit(e.target.value)}
            placeholder="What should Firstmate investigate?"
          />
        </label>
        <div className="row wrap">
          <button className="btn primary" disabled={sending || !text.trim()}>
            Send
          </button>
          <button
            type="button"
            className="btn quiet"
            disabled={sending}
            onClick={() =>
              void send(
                "Draft a message to the blocker owner about this story. Return the draft to this sprint conversation for review.",
              )
            }
          >
            Draft a message
          </button>
        </div>
      </form>
    </article>
  );
}
