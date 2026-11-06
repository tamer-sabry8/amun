export type FirstmateRecord = {
  backend: "tmux";
  taskId: string;
  window: string;
  worktree: string;
  spawnGeneration: string;
  harness: "codex" | "claude";
};
export type EndpointIdentity = Omit<FirstmateRecord, "backend" | "harness"> & {
  paneId: string;
  windowId: string;
  serverPid: number;
  panePid: number;
  ownerToken: string;
};
export type LiveEndpoint = Pick<
  EndpointIdentity,
  "paneId" | "windowId" | "serverPid" | "panePid" | "ownerToken" | "worktree"
> & { dead: boolean };
/** Parse the pinned Firstmate state/<id>.meta format as data, never shell source. */
export function parseFirstmateRecord(text: string): FirstmateRecord {
  if (Buffer.byteLength(text) > 65536 || text.includes("\0"))
    throw new Error("Invalid Firstmate record");
  const values: Record<string, string> = Object.create(null);
  for (const line of text.split("\n")) {
    if (!line) continue;
    const index = line.indexOf("=");
    if (index < 1) throw new Error("Invalid Firstmate record");
    const key = line.slice(0, index);
    if (Object.hasOwn(values, key))
      throw new Error("Ambiguous Firstmate record");
    values[key] = line.slice(index + 1);
  }
  const taskId = values.endpoint_task_id ?? "";
  const window = values.window ?? "";
  const worktree = values.worktree ?? "";
  const spawnGeneration = values.spawn_gen ?? "";
  const harness = values.harness;
  if (
    (values.backend ?? "tmux") !== "tmux" ||
    !/^[-a-zA-Z0-9_]{1,64}$/.test(taskId) ||
    !/^[-a-zA-Z0-9_]+:[-a-zA-Z0-9_@.]+$/.test(window) ||
    !worktree.startsWith("/") ||
    /[\r\n\t]/.test(worktree) ||
    !/^[-a-zA-Z0-9.]{1,128}$/.test(spawnGeneration) ||
    (harness !== "codex" && harness !== "claude")
  )
    throw new Error("Unsupported Firstmate record");
  return {
    backend: "tmux",
    taskId,
    window,
    worktree,
    spawnGeneration,
    harness,
  };
}
/** Recovery has no spawn/send/control capability. Unverified identity is always unknown. */
export function matchOwnedEndpoint(
  owned: EndpointIdentity,
  record: FirstmateRecord,
  live: LiveEndpoint | undefined,
): "verified" | "unknown" {
  if (!live || live.dead) return "unknown";
  for (const key of [
    "taskId",
    "window",
    "worktree",
    "spawnGeneration",
  ] as const)
    if (owned[key] !== record[key]) return "unknown";
  for (const key of [
    "paneId",
    "windowId",
    "serverPid",
    "panePid",
    "ownerToken",
    "worktree",
  ] as const)
    if (owned[key] !== live[key]) return "unknown";
  return "verified";
}

export async function queryTmuxEndpoint(
  socket: string,
  paneId: string,
  run: (args: string[]) => Promise<string>,
): Promise<LiveEndpoint | undefined> {
  try {
    if (
      !socket.startsWith("/") ||
      /[\0\r\n]/.test(socket) ||
      !/^%[0-9]+$/.test(paneId)
    )
      return;
    const ownerToken = (
      await run(["-S", socket, "show-options", "-gqv", "@amun-owner"])
    ).trim();
    if (!/^[a-f0-9]{32}$/.test(ownerToken)) return;
    const inventory = await run([
      "-S",
      socket,
      "list-panes",
      "-a",
      "-F",
      "#{pane_id}|#{window_id}|#{pid}|#{pane_pid}|#{pane_current_path}|#{pane_dead}",
    ]);
    if (inventory.length > 65536) return;
    const matches = inventory
      .trim()
      .split("\n")
      .map((line) => line.split("|"))
      .filter((fields) => fields[0] === paneId);
    if (matches.length !== 1) return;
    const fields = matches[0]!;
    const [actualPane, windowId, server, pid, worktree, dead] = fields;
    if (
      fields.length !== 6 ||
      !actualPane ||
      !windowId ||
      !/^@[0-9]+$/.test(windowId) ||
      !server ||
      !pid ||
      !/^\d+$/.test(server) ||
      !/^\d+$/.test(pid) ||
      !worktree?.startsWith("/") ||
      (dead !== "0" && dead !== "1")
    )
      return;
    const serverPid = Number(server),
      panePid = Number(pid);
    if (
      !Number.isSafeInteger(serverPid) ||
      !Number.isSafeInteger(panePid) ||
      serverPid < 2 ||
      panePid < 2
    )
      return;
    return {
      paneId: actualPane,
      windowId,
      serverPid,
      panePid,
      worktree,
      ownerToken,
      dead: dead === "1",
    };
  } catch {
    return;
  }
}
