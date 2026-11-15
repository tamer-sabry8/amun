import { it, expect, vi } from "vitest";
import { AuthSession } from "../src/session.ts";
import { AuthBroker, type Connection } from "../src/broker.ts";
import {
  KeychainReader,
  KeychainTimeout,
  hangingKeychain,
  keychainWaitingNote,
} from "../src/keychain-reader.ts";
import { Redactor } from "../../security/src/redaction.ts";

const ado: Connection = { kind: "ado", baseUrl: "https://dev.azure.com/acme" };

it("lists connections at once and says so when the Keychain prompt is unanswered", async () => {
  vi.useFakeTimers();
  try {
    const reader = new KeychainReader(hangingKeychain, {
      timeoutMs: 60_000,
    });
    const broker = new AuthBroker(
      "workspace",
      {
        get: () => {
          throw Error("blocking read");
        },
        set: () => undefined,
        delete: () => undefined,
      },
      new Redactor(),
      async () => true,
      reader,
    );
    const events: {
      kind: string;
      message?: string;
      connections?: unknown[];
    }[] = [];
    const session = new AuthSession(
      broker,
      { list: () => [ado], save: () => undefined, remove: () => undefined },
      (event) => events.push(event),
      () => ({ answer: () => undefined, stop: () => undefined }),
    );
    await session.handle({ version: 1, kind: "auth", action: "list" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "auth-connections",
      connections: [{ status: "checking" }],
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events.at(-1)).toMatchObject({
      kind: "auth-notice",
      message: keychainWaitingNote,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events.at(-1)).toMatchObject({
      kind: "auth-connections",
      connections: [{ status: "unknown" }],
    });
  } finally {
    vi.useRealTimers();
  }
});

it("answers a read when the Keychain does, and times out one that never does", async () => {
  vi.useFakeTimers();
  try {
    const account = "workspace/ado-" + "a".repeat(32);
    let reply: ((r: { id: number; value: string }) => void) | undefined;
    const reader = new KeychainReader(
      {
        post: (request) => reply?.({ id: request.id, value: "secret" }),
        onReply: (listener) => {
          reply = listener;
        },
      },
      { timeoutMs: 1000 },
    );
    await expect(reader.get(account)).resolves.toBe("secret");
    const hung = new KeychainReader(hangingKeychain, { timeoutMs: 1000 });
    const result = expect(hung.get(account)).rejects.toBeInstanceOf(
      KeychainTimeout,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await result;
  } finally {
    vi.useRealTimers();
  }
});
