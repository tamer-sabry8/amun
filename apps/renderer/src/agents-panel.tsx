import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  nativePiEvent,
  crewRoster,
  crewInventory,
  crewObserve,
  crewObservation,
} from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function AgentsPanel({
  onOpenWorker,
}: {
  onOpenWorker: (taskId: string) => void;
}) {
  const { generation, status } = useSyncExternalStore(
    bridge.subscribe,
    bridge.getSnapshot,
  );
  const releaseRequest = useRef<string | null>(null);
  const [releaseStatus, setReleaseStatus] = useState("");
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [harness, setHarness] = useState("codex");
  const [charter, setCharter] = useState("");
  function dispatch() {
    if (releaseRequest.current || !charter.trim()) return;
    const id = crypto.randomUUID();
    releaseRequest.current = id;
    setReleaseBusy(true);
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      command: "crew-dispatch",
      id,
      argument: JSON.stringify({ harness, charter }),
    });
  }
  function releaseAction(
    argument: "status" | "prepare" | "rollback" | "crew-home",
  ) {
    if (releaseRequest.current) return;
    const id = crypto.randomUUID();
    releaseRequest.current = id;
    setReleaseBusy(true);
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      command: "firstmate-release",
      argument,
      id,
    });
  }
  useEffect(() => {
    releaseRequest.current = null;
    setReleaseStatus("");
    setReleaseBusy(false);
    if (status !== "Connected" || !generation) return;
    const off = bridge.onEvent((value) => {
      const event = nativePiEvent.safeParse(value);
      if (
        event.success &&
        event.data.kind === "native-pi-result" &&
        event.data.id === releaseRequest.current &&
        event.data.result.kind === "message"
      ) {
        releaseRequest.current = null;
        setReleaseBusy(false);
        setReleaseStatus(event.data.result.text);
        if (/^Firstmate (dispatched|recovered)/.test(event.data.result.text))
          bridge.send({ version: 1, kind: "crew-list" });
      }
    });
    releaseAction("status");
    return off;
  }, [generation, status]);
  const [input, setInput] = useState("");
  const [selection, select] = useState<{ id: string } | null>(null);
  const [answer, setAnswer] = useState<{
    generation: string;
    result: ReturnType<typeof crewObservation.parse>;
  } | null>(null);
  const [inventory, setInventory] = useState<{
    generation: string;
    tasks: string[] | null;
  } | null>(null);
  useEffect(() => {
    if (status !== "Connected" || !generation) return;
    const off = bridge.onEvent((event) => {
      const checked = crewInventory.safeParse(event);
      if (checked.success)
        setInventory({ generation, tasks: checked.data.tasks });
    });
    bridge.send({ version: 1, kind: "crew-list" });
    return off;
  }, [generation, status]);
  const [roster, setRoster] =
    useState<ReturnType<typeof crewRoster.parse>["members"]>();
  const [view, setView] = useState("hierarchy");
  useEffect(() => {
    setRoster(undefined);
    if (status !== "Connected") return;
    const off = bridge.onEvent((raw) => {
      const r = crewRoster.safeParse(raw);
      if (r.success) setRoster(r.data.members);
    });
    bridge.send({ version: 1, kind: "refresh-crew" });
    return off;
  }, [status, generation, inventory]);
  const member = roster?.find((m) => m.id === selection?.id);
  const taskId = selection?.id;
  useEffect(() => {
    if (!selection || status !== "Connected" || !generation) return;
    const unsubscribe = bridge.onEvent((value) => {
      const checked = crewObservation.safeParse(value);
      if (checked.success && checked.data.taskId === selection.id)
        setAnswer({ generation, result: checked.data });
    });
    bridge.send({ version: 1, kind: "crew-observe", taskId: selection.id });
    return unsubscribe;
  }, [selection, generation, status]);
  const result =
    answer?.generation === generation &&
    status === "Connected" &&
    answer?.result.taskId === taskId
      ? answer?.result
      : undefined;
  const valid = crewObserve.safeParse({
    version: 1,
    kind: "crew-observe",
    taskId: input,
  }).success;
  return (
    <section aria-label="Workers">
      <h2>Workers</h2>
      <section aria-label="Crew roster">
        <button
          onClick={() => bridge.send({ version: 1, kind: "refresh-crew" })}
        >
          Refresh crew
        </button>
        <label>
          Crew view
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="hierarchy">Hierarchy</option>
            <option value="list">List</option>
          </select>
        </label>
        {roster === null ? (
          <p>Crew snapshot unavailable.</p>
        ) : (
          roster && (
            <>
              <p aria-label="Crew status counts">
                {[...new Set(roster.map((m) => m.state))]
                  .map(
                    (state) =>
                      state +
                      " " +
                      roster.filter((m) => m.state === state).length,
                  )
                  .join(" · ") || "No workers recorded"}
              </p>
              {view === "hierarchy" && <h3>Firstmate</h3>}
              <ul
                aria-label={
                  view === "hierarchy" ? "Firstmate’s crew" : "Worker list"
                }
              >
                {roster.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => {
                        setInput(m.id);
                        select({ id: m.id });
                      }}
                    >
                      {m.id}
                    </button>{" "}
                    · {m.state} · Endpoint {m.endpoint}
                  </li>
                ))}
              </ul>
            </>
          )
        )}
        {member && (
          <section aria-label="Selected agent">
            <h3>{member.id}</h3>
            <dl>
              {Object.entries({
                "Current task": member.current,
                "Needs decision": member.decisions.join(" · "),
                "Up next": member.next.join(" · "),
                "Recent work": member.history.at(0),
                "Verified worktree": member.access,
                History: member.history.join(" · "),
              }).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "No record"}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </section>
      <section aria-label="Firstmate runtime">
        <h3>Firstmate runtime</h3>
        <p>
          Choose the revision for new Amun worktrees. Existing workers keep
          their revision.
        </p>
        <button
          disabled={status !== "Connected" || releaseBusy}
          onClick={() => releaseAction("crew-home")}
        >
          Open persistent crew home
        </button>
        <button
          disabled={status !== "Connected" || releaseBusy}
          onClick={() => releaseAction("prepare")}
        >
          Prepare Firstmate worktree
        </button>
        <button
          disabled={status !== "Connected" || releaseBusy}
          onClick={() => releaseAction("rollback")}
        >
          Roll back to previous Firstmate
        </button>
        <label>
          Persistent worker harness
          <select
            value={harness}
            disabled={releaseBusy}
            onChange={(e) => setHarness(e.target.value)}
          >
            <option value="codex">Codex CLI · restricted</option>
            <option value="claude">Claude Code · auto</option>
          </select>
        </label>
        <label>
          Worker charter
          <textarea
            value={charter}
            maxLength={2000}
            disabled={releaseBusy}
            onChange={(e) => setCharter(e.target.value)}
          />
        </label>
        <button
          disabled={status !== "Connected" || releaseBusy || !charter.trim()}
          onClick={dispatch}
        >
          Dispatch through Firstmate
        </button>
        <p role="status" aria-live="polite">
          {releaseBusy ? "Checking Firstmate runtime…" : releaseStatus}
        </p>
      </section>
      {inventory &&
        inventory.generation === generation &&
        status === "Connected" &&
        (inventory.tasks === null ? (
          <p>Saved worker list unavailable.</p>
        ) : inventory.tasks.length ? (
          <label>
            Saved workers
            <select
              value={inventory.tasks.includes(input) ? input : ""}
              onChange={(e) => setInput(e.target.value)}
            >
              <option value="">Choose a worker</option>
              {inventory.tasks.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
        ) : (
          <p>No saved workers in this workspace.</p>
        ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            setAnswer(null);
            select({ id: input });
          }
        }}
      >
        <label>
          Firstmate task ID
          <input
            value={input}
            maxLength={64}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <button
          disabled={
            !valid || status !== "Connected" || Boolean(selection && !result)
          }
        >
          Observe worker
        </button>
      </form>
      {taskId && (
        <>
          <p
            aria-live="polite"
            data-testid="agent-endpoint"
            data-service-generation={result ? generation : undefined}
          >
            {taskId} · Endpoint{" "}
            {result?.endpoint ??
              (status === "Connected" ? "checking" : "unknown")}
          </p>
          {result?.run && (
            <p>
              {result.run.harness} · {result.run.branch}
            </p>
          )}
          {result?.endpoint === "verified" && taskId && (
            <button onClick={() => onOpenWorker(taskId)}>
              Open verified worker terminal
            </button>
          )}
          <p>Worker task status: unknown</p>
        </>
      )}
    </section>
  );
}
