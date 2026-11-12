// First-run wizard (handoff §5): four prompt-led steps. Setup only; it never
// starts work. Every step can be skipped and finished later in Settings.
import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import { modelLoginOptions } from "@amun/contracts";
import {
  groupCards,
  initialWizard,
  suggestedAgents,
  unresolvedRoutes,
  wizardReducer,
  wizardSteps,
  workCards,
} from "../../../../packages/domain/src/work/shell.ts";
import {
  connectionStatus,
  fromLegacyStatus,
  shouldAutoTest,
} from "../../../../packages/domain/src/work/home.ts";
import { trackerName } from "../../../../packages/domain/src/work/flows.ts";
import { bridge } from "../bridge.ts";
import { Icon } from "../icons.tsx";
import { NativePiPanel } from "../native-pi-panel.tsx";
import { work } from "./store.ts";

export const tools = [
  ["ado", "Azure DevOps"],
  ["notion", "Notion"],
  ["github", "GitHub"],
  ["obsidian", "Obsidian"],
] as const;
// One sign-in powers Firstmate and its agents. Cards follow what the bundled
// sign-in service supports today; see the rebuild notes for the remainder.
export const providers = [
  {
    provider: "openai-codex",
    type: "oauth",
    label: "ChatGPT Plus/Pro",
    note: "Use your ChatGPT subscription",
  },
  {
    provider: "github-copilot",
    type: "oauth",
    label: "GitHub Copilot",
    note: "GitHub.com or your company’s GitHub",
  },
  {
    provider: "openrouter",
    type: "oauth",
    label: "OpenRouter",
    note: "One account, many models",
  },
] as const;
export const keyProviders = modelLoginOptions.filter(
  (option) => option.type === "api_key",
);
const testedKey = "amun.models.testedAt";

const readyKey = "amun.models.everReady";
const everReady = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(readyKey) ?? "[]");
  } catch {
    return [];
  }
};

/** Sign-in cards with the four-state status. Auto-tests at most once a day. */
export function ModelCards() {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const [keys, setKeys] = useState(false);
  const [attempted, setAttempted] = useState<string[]>([]);
  const [worked, setWorked] = useState(everReady);
  useEffect(() => {
    if (state.status !== "Connected") return;
    const last = localStorage.getItem(testedKey);
    if (!shouldAutoTest(last, Date.now(), "open")) return;
    localStorage.setItem(testedKey, new Date().toISOString());
    for (const provider of new Set(
      modelLoginOptions.map((option) => option.provider),
    ))
      bridge.send({ version: 1, kind: "auth", action: "readiness", provider });
  }, [state.status]);
  useEffect(() => {
    for (const [provider, status] of Object.entries(state.modelStatus)) {
      // Stored credentials prove nothing: test once, straight after sign-in.
      if (status === "configured")
        bridge.send({
          version: 1,
          kind: "auth",
          action: "readiness",
          provider,
        });
      if (status === "ready" && !worked.includes(provider)) {
        const next = [...worked, provider];
        localStorage.setItem(readyKey, JSON.stringify(next));
        setWorked(next);
      }
    }
  }, [state.modelStatus]);
  const login = (provider: string, type: string) => {
    setAttempted((list) => [...new Set([...list, provider])]);
    bridge.send({ version: 1, kind: "auth", action: "login", provider, type });
  };
  const card = (
    provider: string,
    type: string,
    label: string,
    note: string,
  ) => {
    const view = connectionStatus({
      state: fromLegacyStatus(state.modelStatus[provider], {
        everReady: worked.includes(provider),
        attempted: attempted.includes(provider),
      }),
    });
    return (
      <div className="rb-provider" key={provider + type}>
        <strong>{label}</strong>
        <span className={"status " + view.tone}>
          <Icon name={view.icon} width={15} height={15} />
          {view.text}
        </span>
        <span className="muted small">{note}</span>
        {view.action ? (
          <button className="btn" onClick={() => login(provider, type)}>
            {view.action === "Try again" ? "Sign in again" : view.action}
          </button>
        ) : (
          <span />
        )}
      </div>
    );
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {providers.map((item) =>
        card(item.provider, item.type, item.label, item.note),
      )}
      {keys ? (
        keyProviders.map((item) =>
          card(
            item.provider,
            item.type,
            item.label,
            "Paste a key from the provider",
          ),
        )
      ) : (
        <button
          className="link"
          style={{ justifySelf: "start" }}
          onClick={() => setKeys(true)}
        >
          Use an API key instead
        </button>
      )}
    </div>
  );
}

export function Wizard({ connected }: { connected: string[] }) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizard);
  const [custom, setCustom] = useState("");
  const [agent, setAgent] = useState("");
  const [extraAgents, setExtraAgents] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const bridgeState = useSyncExternalStore(
    bridge.subscribe,
    bridge.getSnapshot,
  );
  const index = wizardSteps.findIndex(([id]) => id === state.step);
  const [, , question] = wizardSteps[index]!;
  const detected = tools
    .filter(([id]) => connected.includes(id))
    .map(([id]) => id);
  const chosenTools = [...new Set([...detected, ...state.tools])];
  const ready = Object.values(bridgeState.modelStatus).some(
    (status) => fromLegacyStatus(status) === "connected",
  );
  useEffect(() => {
    if (!state.done) return;
    work("finish-setup", {
      workTypes: state.workTypes as ("product" | "project" | "task" | "rfp")[],
      tools: chosenTools,
      agents: state.agents,
      groups: state.groups.map((group) => ({
        name: group.name,
        routes: group.routes.map((route) => ({
          condition: route.condition as
            "delivery" | "product" | "task" | "rfp" | null,
          tracker: route.tracker,
        })),
      })),
    });
  }, [state.done]);
  const trackers = [
    ...chosenTools.filter((tool) => tool !== "obsidian"),
    "amun",
  ];
  return (
    <div className="rb-wizard">
      <ol className="rb-steps" style={{ listStyle: "none", margin: 0 }}>
        {wizardSteps.map(([id, label], position) => (
          <li key={id} style={{ display: "contents" }}>
            <span
              aria-current={id === state.step ? "step" : undefined}
              className={position < index ? "done" : ""}
            >
              {position < index && <Icon name="check" width={14} height={14} />}
              {label}
            </span>
          </li>
        ))}
      </ol>
      <main className="rb-wizard-body">
        <h1>{question}</h1>
        {state.step === "models" && (
          <>
            <p className="muted">
              One sign-in powers Firstmate and your agents. Codex and Claude
              Code on this Mac are reused when they are already signed in.
            </p>
            <ModelCards />
            <p className="row">
              <span className="muted">
                {ready
                  ? "Firstmate picks a model for each kind of task."
                  : "Sign in to pick models. You can do this later."}
              </span>
              <button className="link" onClick={() => setReview(!review)}>
                {review ? "Hide details" : "Review"}
              </button>
            </p>
            {review && (
              <div className="legacy-surface">
                <NativePiPanel subscriptionsOnly />
              </div>
            )}
          </>
        )}
        {state.step === "tools" && (
          <>
            <p className="muted">
              Pick the ones you use. Each can be connected now or when it first
              matters.
            </p>
            <div className="rb-cards">
              {tools.map(([id, label]) => {
                const on = detected.includes(id);
                return (
                  <button
                    key={id}
                    className="rb-card"
                    aria-pressed={chosenTools.includes(id)}
                    disabled={on}
                    onClick={() =>
                      dispatch({ type: "toggle", field: "tools", value: id })
                    }
                  >
                    <strong>{label}</strong>
                    <span>
                      {on ? "Already connected" : "Connect when needed"}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {state.step === "work" && (
          <>
            <div className="rb-cards">
              {workCards.map(([id, label]) => (
                <button
                  key={id}
                  className="rb-card"
                  aria-pressed={state.workTypes.includes(id)}
                  onClick={() =>
                    dispatch({ type: "toggle", field: "workTypes", value: id })
                  }
                >
                  <strong>{label}</strong>
                </button>
              ))}
            </div>
            <h2 style={{ marginTop: 12 }}>
              Which contexts should I keep separate?
            </h2>
            <p className="muted">
              Information stays inside its group unless you say otherwise.
            </p>
            <div className="rb-cards">
              {[
                ...groupCards,
                ...state.groups
                  .map((group) => group.name)
                  .filter(
                    (name) => !(groupCards as readonly string[]).includes(name),
                  ),
              ].map((name) => (
                <button
                  key={name}
                  className="rb-card"
                  aria-pressed={state.groups.some(
                    (group) => group.name === name,
                  )}
                  onClick={() => dispatch({ type: "group", name })}
                >
                  <strong>{name}</strong>
                </button>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(event) => {
                event.preventDefault();
                dispatch({ type: "group", name: custom });
                setCustom("");
              }}
            >
              <input
                type="text"
                className="grow"
                aria-label="Add another group"
                placeholder="Add another, e.g. a client or a side project"
                value={custom}
                maxLength={64}
                onChange={(event) => setCustom(event.target.value)}
              />
              <button className="btn" disabled={!custom.trim()}>
                Add
              </button>
            </form>
            {state.groups.map((group) => (
              <section
                className="rb-inline"
                key={group.name}
                style={{ maxWidth: "none" }}
              >
                <label className="field">
                  Group name
                  <input
                    type="text"
                    defaultValue={group.name}
                    maxLength={64}
                    onBlur={(event) =>
                      dispatch({
                        type: "rename_group",
                        from: group.name,
                        to: event.target.value,
                      })
                    }
                  />
                </label>
                <strong>Where should actionable work be tracked?</strong>
                <div className="rb-route">
                  {(
                    [
                      [null, "Everything in this group"],
                      ["delivery", "Client delivery tickets"],
                    ] as const
                  ).map(([condition, label]) => (
                    <label className="field" key={label}>
                      {label}
                      <select
                        value={
                          group.routes.find(
                            (route) => route.condition === condition,
                          )?.tracker ?? ""
                        }
                        onChange={(event) =>
                          event.target.value &&
                          dispatch({
                            type: "route",
                            group: group.name,
                            condition,
                            tracker: event.target.value,
                          })
                        }
                      >
                        <option value="">
                          {condition
                            ? "Same as the rest"
                            : "Ask me when it matters"}
                        </option>
                        {trackers.map((tracker) => (
                          <option key={tracker} value={tracker}>
                            {tracker === "amun"
                              ? "Keep it in Amun"
                              : trackerName(tracker)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>
            ))}
            {unresolvedRoutes(state).length > 0 && (
              <p className="muted small">
                I’ll ask where to track work for{" "}
                {unresolvedRoutes(state).join(", ")} the first time it matters.
              </p>
            )}
          </>
        )}
        {state.step === "agents" && (
          <>
            <p className="muted">
              Firstmate leads. These agents help with the work you delegate; tap
              to choose.
            </p>
            <div className="rb-cards">
              {[
                ...suggestedAgents.map((item) => item.role),
                ...extraAgents,
              ].map((role) => (
                <button
                  key={role}
                  className="rb-card"
                  aria-pressed={state.agents.includes(role)}
                  onClick={() =>
                    dispatch({ type: "toggle", field: "agents", value: role })
                  }
                >
                  <strong>{role}</strong>
                  <span>
                    {suggestedAgents.find((item) => item.role === role)
                      ?.recommended
                      ? "Recommended"
                      : "Optional"}
                  </span>
                </button>
              ))}
            </div>
            <form
              className="row"
              onSubmit={(event) => {
                event.preventDefault();
                const role = agent.trim();
                if (!role) return;
                setExtraAgents([...new Set([...extraAgents, role])]);
                if (!state.agents.includes(role))
                  dispatch({ type: "toggle", field: "agents", value: role });
                setAgent("");
              }}
            >
              <input
                type="text"
                className="grow"
                aria-label="Add an agent"
                placeholder="Add an agent, e.g. Pricing analyst"
                value={agent}
                maxLength={64}
                onChange={(event) => setAgent(event.target.value)}
              />
              <button className="btn" disabled={!agent.trim()}>
                Add an agent
              </button>
            </form>
          </>
        )}
        <div className="rb-wizard-foot">
          {index > 0 && (
            <button
              className="btn quiet"
              onClick={() => dispatch({ type: "back" })}
            >
              Back
            </button>
          )}
          <span className="grow" />
          <button
            className="btn primary"
            onClick={() => dispatch({ type: "next" })}
          >
            {index === wizardSteps.length - 1 ? "Finish setup" : "Continue"}
          </button>
        </div>
      </main>
    </div>
  );
}
