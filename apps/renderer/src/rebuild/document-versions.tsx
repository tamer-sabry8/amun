// Version history for a saved document, shown in the document pane. Opening a
// version is read-only; restoring one saves it as a new version.
import type { WorkSnapshot } from "../../../../packages/contracts/src/work.ts";
import { MarkdownDoc } from "./markdown-doc.tsx";
import { authorLabel } from "./document-approval.ts";
import { work } from "./store.ts";

type Library = WorkSnapshot["library"][number];

const when = (stamp: string) =>
  new Date(stamp).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export function VersionHistory({
  item,
  version,
  onOpen,
  onClose,
}: {
  item: Library;
  /** The version open to read, or null for the list. */
  version: number | null;
  onOpen(version: number | null): void;
  onClose(): void;
}) {
  const open =
    version === null
      ? null
      : (item.versions.find((entry) => entry.version === version) ?? null);
  if (open)
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="rb-inline amber" role="status">
          <span>
            You are reading version {open.version}, saved {when(open.createdAt)}{" "}
            by {authorLabel[open.author]}. It can’t be edited here.
          </span>
          <div className="row">
            {open.version !== item.version && (
              <button
                className="btn"
                onClick={() => {
                  work("restore-output-version", {
                    outputId: item.id,
                    versionNumber: open.version,
                  });
                  onClose();
                }}
              >
                Restore this version
              </button>
            )}
            <button className="btn quiet" onClick={() => onOpen(null)}>
              Back to all versions
            </button>
          </div>
        </div>
        <MarkdownDoc body={open.body} disabled onToggle={() => undefined} />
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>
          Version history
        </h3>
        <button className="btn quiet" onClick={onClose}>
          Back to the document
        </button>
      </div>
      <div className="rb-rows">
        {item.versions.map((entry) => (
          <button
            key={entry.version}
            className="rb-rowitem"
            onClick={() => onOpen(entry.version)}
          >
            <span>
              <span className="name">
                Version {entry.version}
                {entry.version === item.version ? " (current)" : ""}
              </span>
              <span className="muted small" style={{ display: "block" }}>
                {when(entry.createdAt)} · {authorLabel[entry.author]}
              </span>
            </span>
            <span />
            <span>
              {entry.version === item.approvedVersion && (
                <span className="tag">Approved</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
