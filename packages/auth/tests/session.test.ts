import { it, expect } from "vitest";
import { AuthSession } from "../src/session.ts";
import { AuthBroker, type Connection } from "../src/broker.ts";
import { Redactor } from "../../security/src/redaction.ts";
it("validates commands, persists only connection metadata, clears secrets from replies and closes only its login", async () => {
  const values = new Map<string, string>();
  const connections: Connection[] = [];
  const messages: unknown[] = [];
  let stopped = 0;
  let answers = 0;
  let started = 0;
  const broker = new AuthBroker(
    "workspace",
    {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value);
      },
      delete: (key) => {
        values.delete(key);
      },
    },
    new Redactor(),
    async () => true,
  );
  const session = new AuthSession(
    broker,
    {
      list: () => connections,
      save: (connection) => {
        connections.push(connection);
      },
      remove: () => {
        connections.length = 0;
      },
    },
    (event) => messages.push(event),
    () => {
      started++;
      return {
        answer: () => {
          answers++;
        },
        stop: () => {
          stopped++;
        },
      };
    },
  );
  expect(
    await session.handle({ version: 1, kind: "auth", action: "unknown" }),
  ).toBe(false);
  await session.handle({
    version: 1,
    kind: "auth",
    action: "save",
    connection: { kind: "github", baseUrl: "https://github.com" },
    secret: "CANARY-never-replied",
  });
  expect(connections).toHaveLength(1);
  expect(JSON.stringify(connections)).not.toContain("CANARY");
  expect(JSON.stringify(messages)).not.toContain("CANARY");
  await session.handle({
    version: 1,
    kind: "auth",
    action: "check",
    connection: connections[0],
  });
  expect(JSON.stringify(messages)).toContain("ready");
  await session.handle({
    version: 1,
    kind: "auth",
    action: "login",
    provider: "openrouter",
    type: "oauth",
  });
  await session.handle({
    version: 1,
    kind: "auth",
    action: "login",
    provider: "openrouter",
    type: "oauth",
  });
  expect(started).toBe(1);
  await session.handle({
    version: 1,
    kind: "auth",
    action: "answer",
    id: "prompt",
    answer: "value",
  });
  expect(answers).toBe(1);
  session.close();
  expect(stopped).toBe(1);
  await session.handle({ version: 1, kind: "auth", action: "list" });
  expect(JSON.stringify(messages)).not.toContain("CANARY");
});

function modelSession(
  readiness: (provider: string) => Promise<"configured" | "missing" | "error">,
) {
  const statuses: string[] = [];
  let finish: () => void = () => undefined;
  const session = new AuthSession(
    new AuthBroker(
      "workspace",
      { get: () => undefined, set: () => undefined, delete: () => undefined },
      new Redactor(),
      async () => true,
    ),
    { list: () => [], save: () => undefined, remove: () => undefined },
    (event) => {
      if (event.kind === "auth-status")
        statuses.push(event.id + ":" + event.status);
    },
    (_command, _send, done) => {
      finish = done;
      return { answer: () => undefined, stop: () => undefined };
    },
    readiness,
  );
  const ask = (action: string, provider: string) =>
    session.handle({
      version: 1,
      kind: "auth",
      action,
      provider,
      ...(action === "login" ? { type: "oauth" } : {}),
    });
  return { statuses, ask, finish: () => finish() };
}

it("reports a sign-in that passes its check as ready, so nothing asks again", async () => {
  const { statuses, ask } = modelSession(async () => "configured");
  await ask("readiness", "openai-codex");
  expect(statuses).toEqual(["openai-codex:checking", "openai-codex:ready"]);
});

it("keeps a missing or failing check as it is", async () => {
  const missing = modelSession(async () => "missing");
  await missing.ask("readiness", "openrouter");
  expect(missing.statuses.at(-1)).toBe("openrouter:missing");
  const broken = modelSession(async () => {
    throw Error("lock timeout");
  });
  await broken.ask("readiness", "openrouter");
  expect(broken.statuses.at(-1)).toBe("openrouter:error");
});

it("runs a check asked for during a sign-in once the sign-in ends", async () => {
  const checked: string[] = [];
  const { statuses, ask, finish } = modelSession(async (provider) => {
    checked.push(provider);
    return "configured";
  });
  await ask("login", "github-copilot");
  // Asked while the sign-in holds the credential store: it waits.
  await ask("readiness", "openai-codex");
  await ask("readiness", "openai-codex");
  expect(checked).toEqual([]);
  expect(statuses).toEqual([]);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(checked).toEqual(["openai-codex"]);
  expect(statuses).toEqual(["openai-codex:checking", "openai-codex:ready"]);
});
