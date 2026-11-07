import { useEffect, useState, useSyncExternalStore } from "react";
import { crewInventory, crewObserve, crewObservation } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function AgentsPanel() {
  const { generation, status } = useSyncExternalStore(
    bridge.subscribe,
    bridge.getSnapshot,
  );
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
          <p>Worker task status: unknown</p>
        </>
      )}
    </section>
  );
}
