import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  crewObservation,
  crewRoster,
  crewInventory,
  crewSessionText,
} from "../../../../packages/contracts/src/crew.ts";
import { bridge } from "../bridge.ts";

type Member = NonNullable<
  ReturnType<typeof crewRoster.parse>["members"]
>[number];

/** Read-only live session snapshot for one agent, from the crew bridge. */
export function AgentWatch({
  agentId,
  launcherId,
  name,
}: {
  agentId: string;
  launcherId: string | null;
  name: string;
}) {
  const { generation, status } = useSyncExternalStore(
    bridge.subscribe,
    bridge.getSnapshot,
  );
  const [roster, setRoster] = useState<Member[] | null | undefined>();
  const [tasks, setTasks] = useState<string[] | null>(null);
  const [observed, setObserved] = useState<{
    generation: string | null;
    result: ReturnType<typeof crewObservation.parse>;
  } | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const connected = status === "Connected" && Boolean(generation);
  const wanted = [agentId, launcherId]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  const member = roster?.find((item) => wanted.includes(item.id.toLowerCase()));
  const taskId =
    member?.id ?? tasks?.find((id) => wanted.includes(id.toLowerCase()));

  function refresh() {
    setRefreshed(true);
    bridge.send({ version: 1, kind: "refresh-crew" });
    if (taskId) bridge.send({ version: 1, kind: "crew-observe", taskId });
  }

  useEffect(() => {
    setRoster(undefined);
    setTasks(null);
    setRefreshed(false);
    if (!connected) return;
    const off = bridge.onEvent((raw) => {
      const list = crewRoster.safeParse(raw);
      if (list.success) setRoster(list.data.members);
      const saved = crewInventory.safeParse(raw);
      if (saved.success) setTasks(saved.data.tasks);
    });
    bridge.send({ version: 1, kind: "crew-list" });
    bridge.send({ version: 1, kind: "refresh-crew" });
    return off;
  }, [connected, generation, agentId]);

  useEffect(() => {
    setObserved(null);
    if (!connected || !taskId) return;
    const off = bridge.onEvent((raw) => {
      const checked = crewObservation.safeParse(raw);
      if (checked.success && checked.data.taskId === taskId)
        setObserved({ generation, result: checked.data });
    });
    bridge.send({ version: 1, kind: "crew-observe", taskId });
    return off;
  }, [connected, generation, taskId]);

  const [session, setSession] = useState<{
    taskId: string;
    live: boolean;
    text: string;
  } | null>(null);
  const screen = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);

  // Read-only: asks the service for the crewmate's latest lines every 2 s while this panel is open.
  useEffect(() => {
    setSession(null);
    pinned.current = true;
    if (!connected || !taskId) return;
    const off = bridge.onEvent((raw) => {
      const checked = crewSessionText.safeParse(raw);
      if (checked.success && checked.data.taskId === taskId)
        setSession({
          taskId,
          live: checked.data.live,
          text: checked.data.text,
        });
    });
    const ask = () =>
      bridge.send({ version: 1, kind: "crew-session-read", taskId });
    ask();
    const timer = setInterval(ask, 2000);
    return () => {
      clearInterval(timer);
      off();
    };
  }, [connected, generation, taskId]);

  useEffect(() => {
    const box = screen.current;
    if (box && pinned.current) box.scrollTop = box.scrollHeight;
  }, [session?.text]);

  const result = observed?.generation === generation ? observed.result : null;
  const rows: [string, string][] = member
    ? [
        ["Current task", member.current ?? ""],
        ["Needs a decision", member.decisions.join(" · ")],
        ["Up next", member.next.join(" · ")],
        ["Recent work", member.history.at(0) ?? ""],
        ["History", member.history.join(" · ")],
      ]
    : [];
  const line = !connected
    ? "Not connected yet. Live details appear once Amun is connected."
    : roster === null
      ? "The crew snapshot is not available right now."
      : roster === undefined
        ? "Checking on " + name + "…"
        : !member
          ? name + " has no live session right now."
          : result?.endpoint === "verified"
            ? "Live session confirmed" +
              (result.run
                ? " · " + result.run.harness + " · " + result.run.branch
                : "")
            : "Live session not confirmed yet";

  return (
    <div
      aria-label={"Watch " + name}
      role="group"
      style={{ display: "grid", gap: 6 }}
    >
      <div className="rb-inline" style={{ alignItems: "center" }}>
        <p className="muted small" role="status" aria-live="polite">
          {line}
        </p>
        <span className="grow" />
        <button
          className="btn quiet"
          disabled={!connected}
          onClick={refresh}
          aria-label={"Refresh " + name}
        >
          Refresh
        </button>
      </div>
      {refreshed && roster !== undefined && member && (
        <p className="muted small" aria-live="polite">
          Updated just now.
        </p>
      )}
      {rows.length > 0 && (
        <div className="rb-rows">
          {rows.map(([label, value]) => (
            <div key={label} className="rb-rowitem">
              <span className="name">{label}</span>
              <span style={{ gridColumn: "2 / -1" }}>
                {value || "Nothing recorded"}
              </span>
            </div>
          ))}
        </div>
      )}
      {connected && member && (
        <section
          aria-label="Live session"
          style={{ display: "grid", gap: 6, marginTop: 8 }}
        >
          <h3 style={{ margin: 0 }}>Live session</h3>
          {session?.live ? (
            <>
              <p className="muted small">
                Watching {name} · updates every 2 seconds
              </p>
              <pre
                ref={screen}
                className="rb-session"
                tabIndex={0}
                aria-label={"Live session of " + name}
                onScroll={(event) => {
                  const box = event.currentTarget;
                  pinned.current =
                    box.scrollHeight - box.scrollTop - box.clientHeight < 24;
                }}
              >
                {session.text || "Nothing on screen yet."}
              </pre>
            </>
          ) : (
            <p className="muted small" role="status" aria-live="polite">
              {session
                ? name + " isn't running a session right now."
                : "Checking…"}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
