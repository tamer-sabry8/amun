import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authEvent } from "../../contracts/src/auth.ts";
import {
  GrantKeyring,
  NotionHost,
  notionAccount,
  type NotionEvent,
  type NotionHostOptions,
} from "../src/host.ts";

function memorySecrets() {
  const values = new Map<string, string>();
  return {
    values,
    get: async (account: string) => values.get(account),
    set: async (account: string, secret: string) => {
      values.set(account, secret);
    },
    delete: async (account: string) => {
      values.delete(account);
    },
  };
}
function memorySettings() {
  const values = new Map<string, string>();
  return {
    values,
    get: (id: string) => values.get(id) ?? null,
    set: (id: string, value: string) => void values.set(id, value),
    remove: (ids: string[]) => ids.forEach((id) => values.delete(id)),
  };
}
type Fake = NonNullable<NotionHostOptions["connection"]>;
function host(connection: Partial<Fake>) {
  const secrets = memorySecrets();
  const settings = memorySettings();
  const emitted: NotionEvent[] = [];
  const root = join(mkdtempSync(join(tmpdir(), "amun-notion-")), "notion");
  const made = new NotionHost({
    workspace: "amun",
    root,
    secrets,
    settings,
    registerSecret: () => undefined,
    redact: (text) => text.replaceAll("s3cret", "[REDACTED]"),
    connection: {
      identity: undefined,
      connect: async () => undefined,
      disconnect: async () => undefined,
      cancelLogin: () => undefined,
      inspectTarget: async () => {
        throw Error("unused");
      },
      memoryField: async () => {
        throw Error("unused");
      },
      ...connection,
    } as Fake,
  });
  const send = (message: Record<string, unknown>) =>
    made.handle({ version: 1, kind: "auth", ...message }, (event) =>
      emitted.push(event),
    );
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { made, send, emitted, settings, secrets, root, settled };
}

describe("the Notion connection in the daemon", () => {
  it("says whether a connection was saved without touching the Keychain or the network", () => {
    const { send, settings } = host({});
    expect(send({ action: "notion-status" })).toEqual([
      { version: 1, kind: "auth-status", id: "notion-mcp", status: "missing" },
    ]);
    settings.set("notion.saved", "true");
    expect(authEvent.parse(send({ action: "notion-status" })[0])).toMatchObject(
      { status: "configured" },
    );
  });

  it("answers a sign-in at once with checking, then ready once the browser is done", async () => {
    const calls: unknown[] = [];
    const { send, emitted, settings, settled } = host({
      identity: { workspaceId: "w", workspaceName: "Tahaluf" } as never,
      connect: async (browser, interactive) => {
        calls.push([browser, interactive]);
      },
    });
    expect(send({ action: "notion-connect", browser: "dia" })).toMatchObject([
      { status: "checking" },
    ]);
    await settled();
    expect(calls).toEqual([["dia", true]]);
    expect(emitted.map((event) => authEvent.parse(event))).toMatchObject([
      { kind: "auth-status", status: "ready" },
      {
        kind: "auth-notice",
        message:
          "Notion MCP connected to Tahaluf. Publishing still requires review.",
      },
    ]);
    expect(settings.get("notion.saved")).toBe("true");
  });

  it("reports a sign-in that did not complete and saves nothing", async () => {
    const { send, emitted, settings, settled } = host({
      connect: async () => {
        throw Error("closed the browser, token s3cret");
      },
    });
    send({ action: "notion-connect", browser: "edge" });
    await settled();
    expect(emitted).toMatchObject([
      { status: "error" },
      { kind: "auth-notice" },
    ]);
    expect(JSON.stringify(emitted)).not.toContain("s3cret");
    expect(settings.get("notion.saved")).toBeNull();
  });

  it("checks a destination and remembers it; a failed check changes nothing", async () => {
    const good = host({
      inspectTarget: async () =>
        ({ title: "test for Amun to use", parentType: "page_id" }) as never,
    });
    good.send({
      action: "notion-target",
      url: "https://www.notion.so/test-0123456789abcdef0123456789abcdef",
    });
    await good.settled();
    expect(good.emitted[0]).toMatchObject({
      kind: "auth-notice",
      message:
        "Notion verified test for Amun to use (page). Publication is still blocked until content and destination are reviewed.",
    });
    expect(good.settings.get("notion.destination.title")).toBe(
      '"test for Amun to use"',
    );

    const bad = host({
      inspectTarget: async () => {
        throw Error("no access");
      },
    });
    bad.send({
      action: "notion-target",
      url: "https://www.notion.so/x-0123456789abcdef0123456789abcdef",
    });
    await bad.settled();
    expect(bad.emitted[0]).toMatchObject({ kind: "auth-notice" });
    expect(bad.settings.get("notion.destination")).toBeNull();
  });

  it("disconnect removes what was saved and says the grant can also be revoked in Notion", async () => {
    const { send, emitted, settings, settled } = host({});
    settings.set("notion.saved", "true");
    settings.set("notion.destination", '"https://www.notion.so/x"');
    send({ action: "notion-disconnect" });
    await settled();
    expect(emitted[0]).toMatchObject({ status: "missing" });
    expect(settings.get("notion.saved")).toBeNull();
    expect(settings.get("notion.destination")).toBeNull();
  });

  it("keeps its sign-in lock folder for the owner only", () => {
    const { root } = host({});
    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it("answers only its own messages", () => {
    expect(NotionHost.handles({ kind: "auth", action: "notion-status" })).toBe(
      true,
    );
    expect(NotionHost.handles({ kind: "auth", action: "list" })).toBe(false);
    expect(NotionHost.handles({ kind: "workspace", action: "snapshot" })).toBe(
      false,
    );
  });
});

describe("linked memory fields", () => {
  const command = {
    version: 1,
    kind: "workspace",
    productId: "p",
    action: "link-memory",
    record: "r",
    field: "summary",
    label: "Summary",
    url: "https://www.notion.so/x-0123456789abcdef0123456789abcdef",
  };
  function syncing(run: () => Promise<void>) {
    const emitted: NotionEvent[] = [];
    const made = new NotionHost({
      workspace: "amun",
      root: join(mkdtempSync(join(tmpdir(), "amun-notion-")), "notion"),
      secrets: memorySecrets(),
      settings: memorySettings(),
      registerSecret: () => undefined,
      redact: (text) => text,
      memory: { run, snapshot: () => ({ kind: "workspace-snapshot" }) },
      connection: {
        identity: undefined,
        connect: async () => undefined,
        disconnect: async () => undefined,
        cancelLogin: () => undefined,
        inspectTarget: async () => {
          throw Error("unused");
        },
        memoryField: async () => {
          throw Error("unused");
        },
        lookup: async () => {
          throw Error("unused");
        },
      } as Fake,
    });
    return { made, emitted, emit: (event: NotionEvent) => emitted.push(event) };
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("runs one exchange at a time and answers with the product again", async () => {
    let finish: () => void = () => undefined;
    const { made, emitted, emit } = syncing(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    expect(NotionHost.handles(command)).toBe(true);
    expect(made.handle(command, emit)).toEqual([]);
    await settled();
    // A second one waits its turn in plain words, and changes nothing.
    expect(made.handle(command, emit)).toMatchObject([
      { kind: "workspace-error", message: "A memory sync is in progress." },
    ]);
    finish();
    await settled();
    expect(emitted).toEqual([{ kind: "workspace-snapshot" }]);
    expect(made.handle(command, emit)).toEqual([]);
  });

  it("says so when the review changed or the mapping is gone", async () => {
    const { made, emitted, emit } = syncing(async () => {
      throw Error("Product changed");
    });
    made.handle(command, emit);
    await settled();
    expect(emitted).toMatchObject([{ kind: "workspace-error" }]);
  });
});

describe("the grant between the connection and the Keychain", () => {
  it("loads the grant once, and saves only a change, under one account", async () => {
    const secrets = memorySecrets();
    const account = notionAccount("amun");
    secrets.values.set(account, "stored");
    const keyring = new GrantKeyring(account, secrets);
    await keyring.load();
    expect(keyring.get(account)).toBe("stored");
    expect(keyring.get("someone/else")).toBeUndefined();
    await keyring.save();
    expect(secrets.values.get(account)).toBe("stored");

    keyring.set(account, "renewed");
    await keyring.save();
    expect(secrets.values.get(account)).toBe("renewed");
    expect(() => keyring.set("someone/else", "x")).toThrow();

    keyring.delete(account);
    await keyring.save();
    expect(secrets.values.has(account)).toBe(false);
  });
});
