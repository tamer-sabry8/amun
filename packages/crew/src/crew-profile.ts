import { bearingsSnapshot } from "../../contracts/src/bearings.ts";
import { Redactor } from "../../security/src/redaction.ts";
import type { Run } from "../../contracts/src/entities.ts";
export function crewProfile(
  id: string,
  s: ReturnType<typeof bearingsSnapshot.parse>,
  live: { endpoint: "verified" | "unknown"; run?: Run },
  redactor = new Redactor(),
) {
  const rows = [...s.secondmates, ...s.in_flight].filter((r) => r.id === id);
  const field = (row: Record<string, unknown> | undefined, keys: string[]) => {
    for (const key of keys) {
      const v = row?.[key];
      if (typeof v === "string" && v.trim() && v !== "-")
        return redactor.text(v).slice(0, 2048);
    }
    return null;
  };
  const owned = (rows: Record<string, unknown>[], keys: string[]) =>
    rows
      .filter((r) => r.owner === id || r.task === id || r.id === id)
      .map((r) => field(r, keys))
      .filter((v): v is string => v !== null)
      .slice(0, 50);
  return {
    id,
    state: field(rows[0], ["state"]) ?? "unknown",
    current: field(rows[0], ["doing", "summary", "title"]),
    endpoint: live.endpoint,
    access: live.endpoint === "verified" ? (live.run?.worktree ?? null) : null,
    decisions: owned(s.decisions_open, ["question", "summary"]),
    next: owned(s.gates, ["title", "reason"]),
    history: owned(s.landed, ["what", "artifact"]),
  };
}
