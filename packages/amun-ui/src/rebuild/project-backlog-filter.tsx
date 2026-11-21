import { useState } from "react";
import { browserStore } from "../backlog-selection.ts";

type Scope = {
  productId: string;
  sourceId: string;
  team: string;
  backlog: string;
};

export function projectFilterKey(scope: Scope) {
  return (
    "amun.backlog-filter.v1:" +
    JSON.stringify([scope.productId, scope.sourceId, scope.team, scope.backlog])
  );
}

export function matchesProjectTag(
  labels: readonly string[] | undefined,
  tag: string,
) {
  return (
    !tag || !!labels?.some((label) => label.toLowerCase() === tag.toLowerCase())
  );
}

export function useProjectFilter(scope: Scope) {
  const key = projectFilterKey(scope);
  const [, redraw] = useState(0);
  const [fullKey, setFullKey] = useState("");
  let tag = "";
  try {
    tag = browserStore()?.getItem(key) ?? "";
  } catch {}
  const [failure, setFailure] = useState("");
  return {
    tag,
    full: fullKey === key,
    failure,
    toggle: () => setFullKey(fullKey === key ? "" : key),
    save(value: string) {
      try {
        const storage = browserStore();
        if (!storage) throw Error();
        if (value.trim()) storage.setItem(key, value.trim());
        else storage.removeItem(key);
        setFullKey("");
        setFailure("");
        redraw((n) => n + 1);
      } catch {
        setFailure("Couldn’t save this project filter.");
      }
    },
  };
}

export function ProjectFilter({
  filter,
  labels,
  matching,
  total,
  noun,
}: {
  filter: ReturnType<typeof useProjectFilter>;
  labels: string[];
  matching: number;
  total: number;
  noun: "sprint" | "backlog";
}) {
  return (
    <section aria-label={"Project " + noun + " filter"}>
      {filter.tag && (
        <div className="row wrap">
          <span>
            {filter.full ? total : matching} of {total} team stories ·{" "}
            {filter.full ? "Full team" : filter.tag}
          </span>
          <button className="btn quiet" onClick={filter.toggle}>
            {filter.full ? "Show project filter" : "Show full team " + noun}
          </button>
        </div>
      )}
      <details>
        <summary>Project tag filter</summary>
        <form
          key={filter.tag}
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("tag");
            if (typeof value === "string") filter.save(value);
          }}
        >
          <label>
            Azure tag{" "}
            <select name="tag" defaultValue={filter.tag}>
              <option value="">Full team {noun}</option>
              {[...new Set([filter.tag, ...labels])]
                .filter(Boolean)
                .sort()
                .map((label) => (
                  <option key={label}>{label}</option>
                ))}
            </select>
          </label>
          <button className="btn">Save project filter</button>
        </form>
      </details>
      {filter.failure && <p role="alert">{filter.failure}</p>}
    </section>
  );
}
