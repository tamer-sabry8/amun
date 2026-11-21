import { browserStore } from "../backlog-selection.ts";
import { newRequestRef } from "../../../domain/src/work/requests.ts";
import { useRef, useState } from "react";
import type { WorkSnapshot } from "../../../contracts/src/work.ts";
import { workAsync } from "./store.ts";
import { inspectView } from "../daemon/navigation.ts";
import { blockerLine } from "../../../domain/src/work/blockers.ts";
type Blocker = WorkSnapshot["blockers"][number];
type Story = { id: string; title: string; indicator?: { blocked: boolean } };
export function SprintBlockers({
  blockers,
  areaId,
  project,
  sprintId,
  name,
  sourceId,
  stories,
  teamId,
  refresh,
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
  teamId?: string;
  refresh?(): void;
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
  const [trackedStory, trackStory] = useState("");
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
                ...(teamId ? { teamId } : {}),
                ...(trackedStory === story &&
                stories.find((s) => s.id === story)?.indicator?.blocked
                  ? { trackAzureIndicator: true as const }
                  : {}),
              });
              if (result.ok) refresh?.();
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
            {stories.find((s) => s.id === story)?.indicator?.blocked && (
              <label>
                <input
                  type="checkbox"
                  checked={trackedStory === story}
                  onChange={(e) => trackStory(e.target.checked ? story : "")}
                />{" "}
                Resolve this blocker when Azure clears the story’s Blocked field
              </label>
            )}
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
  const busy = useRef(false);
  const [note, setNote] = useState("");
  const [edited, setEdited] = useState<{ ref: string; value: string } | null>(
    null,
  );
  const nudge = blocker.nudge;
  const draftKey = nudge
    ? "amun.blocker-message:" +
      JSON.stringify([blocker.workAreaId, blocker.id, nudge.ref])
    : "";
  let cached: string | null = null;
  try {
    cached = draftKey ? (browserStore()?.getItem(draftKey) ?? null) : null;
  } catch {}
  const body =
    nudge?.state === "manual"
      ? nudge.text
      : ((edited?.ref === nudge?.ref ? edited?.value : null) ??
        cached ??
        nudge?.text ??
        "");
  const link = blocker.sprintLink!;
  const editBody = (value: string) => {
    if (!nudge) return;
    setEdited({ ref: nudge.ref, value });
    try {
      browserStore()?.setItem(draftKey, value);
    } catch {
      setNote("This edit is available until you leave this screen.");
    }
  };
  const prepare = async () => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setNote("");
    try {
      const chat = await workAsync("new-chat", {
        told: true,
        workAreaId: blocker.workAreaId,
        sprint: { connection: link.sourceId, id: link.sprintId, name: sprint },
      });
      if (!chat.ok || !chat.ref) {
        setNote(chat.message);
        return;
      }
      const result = await workAsync("draft-blocker-message", {
        areaId: blocker.workAreaId,
        chatId: chat.ref,
        blockerId: blocker.id,
        ref: newRequestRef(),
      });
      if (!result.ok) setNote(result.message);
    } finally {
      setSending(false);
      busy.current = false;
    }
  };
  const record = async (disposition: "copied" | "manual") => {
    if (!nudge || busy.current || !body.trim()) return;
    busy.current = true;
    setSending(true);
    try {
      if (disposition === "copied") await navigator.clipboard.writeText(body);
      const result = await workAsync("record-blocker-message", {
        areaId: blocker.workAreaId,
        blockerId: blocker.id,
        ref: nudge.ref,
        body,
        disposition,
      });
      if (!result.ok) setNote(result.message);
    } catch {
      setNote(
        "Could not copy the message. Select the draft text to copy it manually.",
      );
    } finally {
      setSending(false);
      busy.current = false;
    }
  };
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
      {blocker.azureIndicator && (
        <p className="muted small">
          Azure Blocked field · {blocker.azureIndicator.blocked ? "Yes" : "No"}{" "}
          · Checked{" "}
          {new Date(blocker.azureIndicator.checkedAt).toLocaleString()}
        </p>
      )}
      {blocker.azureCheckPending && (
        <p role="status">Couldn’t verify the linked story’s Blocked field.</p>
      )}
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
            disabled={sending || !!(nudge && nudge.state !== "failed")}
            onClick={() => void prepare()}
          >
            Draft a message
          </button>
        </div>
      </form>
      {nudge && (
        <section className="rb-inline" aria-label="Message to blocker owner">
          <h4>Message to {blocker.owner || "blocker owner"}</h4>
          {nudge.state === "drafting" || nudge.state === "failed" ? (
            <p role="status">
              {nudge.state === "drafting"
                ? "Waiting for Firstmate’s draft."
                : "Draft unavailable. Use Draft a message to try again."}
            </p>
          ) : (
            <>
              <label className="field">
                Message
                <textarea
                  value={body}
                  readOnly={nudge.state === "manual"}
                  maxLength={16000}
                  onChange={(e) => editBody(e.target.value)}
                />
              </label>
              <p className="muted small">
                {nudge.state === "manual"
                  ? "Sent manually · confirmed by you"
                  : nudge.state === "copied"
                    ? "Copied · delivery unconfirmed"
                    : "Draft · delivery unconfirmed"}
              </p>
              {nudge.state !== "manual" && (
                <div className="row wrap">
                  <button
                    className="btn"
                    disabled={sending || !body.trim()}
                    onClick={() => void record("copied")}
                  >
                    Copy message
                  </button>
                  <button
                    className="btn quiet"
                    disabled={sending || !body.trim()}
                    onClick={() => void record("manual")}
                  >
                    I sent it
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {note && <p role="status">{note}</p>}
    </article>
  );
}
