/** Client identity comes from the private server and must match the PTY process exactly. */
export function clientControlArguments(
  pid: number,
  inventory: string,
  enabled: boolean,
): string[] {
  if (!Number.isInteger(pid) || pid < 2 || inventory.length > 65536)
    throw Error("Invalid terminal client");
  const rows = inventory
    .trim()
    .split("\n")
    .map((line) => line.split("|"))
    .filter((row) => row[0] === String(pid));
  if (
    rows.length !== 1 ||
    rows[0]!.length !== 3 ||
    !/^[01]$/.test(rows[0]![2]!) ||
    !/^\/dev\/(ttys[0-9]+|pts\/[0-9]+)$/.test(rows[0]![1]!)
  )
    throw Error("Unverified terminal client");
  if ((rows[0]![2] === "0") === enabled) return [];
  return ["switch-client", "-E", "-c", rows[0]![1]!, "-r"];
}
