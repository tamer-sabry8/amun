// One open blocker with its owner, age and the "It’s unblocked" action. Home
// and the project's own view share it so they always read the same.
import {
  blockerLine,
  type Blocker,
} from "../../../../packages/domain/src/work/blockers.ts";
import { work } from "./store.ts";

export function BlockerRow({
  blocker,
  projectName,
  now,
  onOpen,
}: {
  blocker: Blocker;
  projectName: string | undefined;
  now: number;
  /** Home opens the project; inside the project there is nowhere to go. */
  onOpen?(): void;
}) {
  return (
    <div
      className="rb-att"
      style={onOpen ? undefined : { cursor: "default" }}
      onClick={onOpen}
    >
      <div>
        <div className="label">Blocked · {projectName}</div>
        {onOpen ? (
          <button
            className="title"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {blocker.title}
          </button>
        ) : (
          <div className="title">{blocker.title}</div>
        )}
        <div className="detail">{blockerLine(blocker, now)}</div>
      </div>
      <div className="row" onClick={(event) => event.stopPropagation()}>
        <button
          className="btn"
          aria-label={`Mark “${blocker.title}” as unblocked`}
          onClick={() => work("resolve-blocker", { blockerId: blocker.id })}
        >
          It’s unblocked
        </button>
      </div>
    </div>
  );
}
