import { expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync, symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuthBroker,
  connectionId,
  withRefreshLock,
  modelLoginOptions,
} from "../src/broker.ts";
import { Redactor } from "../../security/src/redaction.ts";
it("keeps independent connection status and stores secrets only in the scoped keyring", async () => {
  const values = new Map<string, string>();
  const keyring = {
    get: (account: string) => values.get(account),
    set: (account: string, value: string) => {
      values.set(account, value);
    },
    delete: (account: string) => {
      values.delete(account);
    },
  };
  const redactor = new Redactor();
  const broker = new AuthBroker(
    "workspace",
    keyring,
    redactor,
    async (connection, secret) =>
      connection.kind === "github" && secret === "CANARY-token",
  );
  const github = { kind: "github" as const, baseUrl: "https://github.com" };
  const ado = {
    kind: "ado" as const,
    baseUrl: "https://devops.example/Collection",
  };
  broker.save(github, "CANARY-token");
  broker.save(ado, "CANARY-ado");
  expect(values.size).toBe(2);
  expect([...values.keys()].every((key) => key.startsWith("workspace/"))).toBe(
    true,
  );
  expect(await broker.check(github)).toBe("ready");
  expect(await broker.check(ado)).toBe("error");
  expect(broker.status(github)).toBe("ready");
  expect(
    broker.status({ kind: "notion", baseUrl: "https://api.notion.com" }),
  ).toBe("missing");
  expect(JSON.stringify(broker.describe([github, ado]))).not.toContain(
    "CANARY",
  );
  expect(
    JSON.stringify(redactor.clean({ value: "CANARY-token" })),
  ).not.toContain("CANARY");
  broker.forget(ado);
  expect(values.size).toBe(1);
  expect(broker.status(ado)).toBe("missing");
});
it("rejects unsafe endpoints, account identifiers and invalid credentials; exposes no Claude subscription login", () => {
  for (const baseUrl of [
    "http://github.com",
    "https://user:pass@github.com",
    "https://github.com/?token=x",
    "file:///tmp",
    "https://github.com/#x",
  ])
    expect(() => connectionId({ kind: "github", baseUrl })).toThrow();
  expect(() =>
    connectionId({ kind: "unknown" as never, baseUrl: "https://github.com" }),
  ).toThrow();
  expect(() =>
    connectionId({ kind: "notion", baseUrl: "https://attacker.example" }),
  ).toThrow();
  const keyring = { get: () => undefined, set: () => {}, delete: () => {} };
  expect(
    () =>
      new AuthBroker("../escape", keyring, new Redactor(), async () => true),
  ).toThrow();
  const broker = new AuthBroker(
    "workspace",
    keyring,
    new Redactor(),
    async () => true,
  );
  for (const secret of ["", "bad\nheader", "x".repeat(65537)])
    expect(() =>
      broker.save({ kind: "github", baseUrl: "https://github.com" }, secret),
    ).toThrow();
  expect(
    modelLoginOptions.some(
      (option) => option.provider === "anthropic" && option.type === "oauth",
    ),
  ).toBe(false);
});
it("serializes real concurrent refresh operations and preserves private lock-root permissions", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-auth-lock-"));
  let active = 0;
  let peak = 0;
  try {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        withRefreshLock(root, async () => {
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active--;
        }),
      ),
    );
    expect(peak).toBe(1);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    const actual = join(root, "actual");
    mkdirSync(actual);
    const link = join(root, "linked");
    symlinkSync(actual, link);
    await expect(withRefreshLock(link, async () => {})).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("does not leak probe or keyring errors to connection status", async () => {
  const broker = new AuthBroker(
    "workspace",
    {
      get: () => {
        throw Error("CANARY");
      },
      set: () => {},
      delete: () => {},
    },
    new Redactor(),
    async () => {
      throw Error("CANARY");
    },
  );
  expect(
    await broker.check({ kind: "github", baseUrl: "https://github.com" }),
  ).toBe("error");
});

it("ignores stale probe results after credentials are replaced or forgotten", async () => {
  const values = new Map<string, string>();
  let complete: (value: boolean) => void = () => {};
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
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const connection = { kind: "github" as const, baseUrl: "https://github.com" };
  broker.save(connection, "old-credential");
  const pending = broker.check(connection);
  broker.save(connection, "new-credential");
  complete(true);
  await pending;
  expect(broker.status(connection)).toBe("configured");
  const pending2 = broker.check(connection);
  broker.forget(connection);
  complete(true);
  await pending2;
  expect(broker.status(connection)).toBe("missing");
});
it("allows internal Notion operations only after a successful scoped connection check and sanitizes failures", async () => {
  const values = new Map<string, string>();
  const redactor = new Redactor();
  const broker = new AuthBroker(
    "workspace",
    {
      get: (k) => values.get(k),
      set: (k, v) => {
        values.set(k, v);
      },
      delete: (k) => {
        values.delete(k);
      },
    },
    redactor,
    async () => true,
  );
  const connection = {
    kind: "notion" as const,
    baseUrl: "https://api.notion.com/",
  };
  let calls = 0;
  const operation = async (secret: string) => {
    calls++;
    expect(secret).toBe("NOTION_CANARY");
    return "safe-result";
  };
  await expect(broker.withNotionCredential(operation)).rejects.toThrow();
  broker.save(connection, "NOTION_CANARY");
  await expect(broker.withNotionCredential(operation)).rejects.toThrow();
  expect(calls).toBe(0);
  await broker.check(connection);
  expect(await broker.withNotionCredential(operation)).toBe("safe-result");
  expect(calls).toBe(1);
  await expect(
    broker.withNotionCredential(async () => {
      throw Error("NOTION_CANARY");
    }),
  ).rejects.toThrow("Notion operation failed");
  expect(redactor.text("NOTION_CANARY")).toBe("[REDACTED]");
  broker.forget(connection);
  await expect(broker.withNotionCredential(operation)).rejects.toThrow();
  expect(calls).toBe(1);
});
