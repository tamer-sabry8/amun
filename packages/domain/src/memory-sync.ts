export type RemoteField =
  { kind: "value"; value: string } | { kind: "deleted" | "unavailable" };
export function syncState(
  baseline: string | null,
  local: string,
  remote: RemoteField,
) {
  if (remote.kind !== "value") return remote.kind;
  if (local === remote.value) return "synced";
  if (local === baseline) return "incoming";
  if (remote.value === baseline) return "outgoing";
  return "conflict";
}
