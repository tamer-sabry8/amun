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
