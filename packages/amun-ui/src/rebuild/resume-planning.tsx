import { browserStore } from "../backlog-selection.ts";
import { inspectView } from "../daemon/navigation.ts";
import {
  savedPlanningLinks,
  type SavedPlanningLink,
} from "./planning-draft.ts";
export function ResumePlanning({
  areas,
  open,
}: {
  areas: ReadonlySet<string>;
  open(link: SavedPlanningLink): void;
}) {
  return (
    <>
      {savedPlanningLinks(browserStore(), areas).map((link) => (
        <button
          className="btn quiet"
          key={link.id}
          onClick={() => {
            inspectView({
              view: "Resume planning draft",
              areaId: link.areaId,
              source: link.sourceId,
              record: link.id,
            });
            open(link);
          }}
        >
          Resume draft · {link.count} {link.count === 1 ? "change" : "changes"}
        </button>
      ))}
    </>
  );
}
