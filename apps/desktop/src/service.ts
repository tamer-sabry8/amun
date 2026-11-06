import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  NotionConnection,
  notionBrowserArgs,
} from "../../../packages/auth/src/notion-connection.ts";
import { authCommand } from "../../../packages/contracts/src/auth.ts";
import { NativePiProcess } from "../../service/src/native-pi-process.ts";
import {
  exportWorkspace,
  restoreWorkspace,
} from "../../../packages/data/src/backup.ts";
import { backupRequest } from "./backup-policy.ts";
import { checkPiReadiness } from "../../../packages/auth/src/readiness.ts";
import { WorkspaceService } from "../../../packages/data/src/workspace-service.ts";
import { workspaceIdentity } from "../../../packages/data/src/identity.ts";
import {
  AuthBroker,
  connectionId,
  type Connection,
} from "../../../packages/auth/src/broker.ts";
import {
  macKeyring,
  type EntryLike,
} from "../../../packages/auth/src/keyring.ts";
import { probeConnection } from "../../../packages/auth/src/probe.ts";
import { AuthSession } from "../../../packages/auth/src/session.ts";
import { connectionSchema } from "../../../packages/contracts/src/auth.ts";
import { startPiLogin } from "../../service/src/auth-process.ts";
import { SafeOutputs } from "../../../packages/data/src/audit.ts";
import {
  Redactor,
  createSafeLogger,
} from "../../../packages/security/src/redaction.ts";
import { ActionStore } from "../../../packages/data/src/outbox.ts";
import type Database from "better-sqlite3";
import { openWorkspace } from "../../../packages/data/src/workspace.ts";
import { CrewObserver } from "../../service/src/crew-observer.ts";
import { observeOwnedTmux } from "../../../packages/crew/src/observe-owned-tmux.ts";
import { openBackendTerminal } from "../../service/src/backend-terminal.ts";
import { backendTerminalOpen } from "../../../packages/contracts/src/terminal.ts";
import { piOpen } from "../../../packages/contracts/src/index.ts";
import { openPiProtocol } from "../../service/src/pi-runtime.ts";
import { type PiSession } from "../../service/src/pi-session.ts";
import { handleHealthRequest } from "../../service/src/health.js";
import { TerminalSession, type Pty } from "../../service/src/terminal.js";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const requireNative = createRequire(join(process.cwd(), "amun-native.cjs"));
const databaseModule = process.env.AMUN_DATABASE_MODULE;
const workspaceRoot = process.env.AMUN_WORKSPACE_ROOT;
if (!databaseModule || !workspaceRoot)
  throw new Error("Workspace runtime unavailable");
const workspace = openWorkspace(
  workspaceRoot,
  requireNative(databaseModule) as typeof Database,
);
const redactor = new Redactor();
const logger = createSafeLogger(redactor, process.stdout);
const outputs = new SafeOutputs(workspace, redactor, logger);
outputs.audit("system", "service.started", "workspace", {});
const workspaceService = new WorkspaceService(workspace);
const actions = new ActionStore(workspace);
actions.recover();
const authKeyring = () => {
  const modulePath = process.env.AMUN_AUTH_MODULE;
  if (!modulePath) throw Error("Auth runtime unavailable");
  const native = requireNative(modulePath) as {
    Entry: new (service: string, account: string) => EntryLike;
  };
  return macKeyring(native.Entry);
};
const authBroker = new AuthBroker(
  workspaceIdentity(workspace),
  {
    get: (account) => authKeyring().get(account),
    set: (account, value) => authKeyring().set(account, value),
    delete: (account) => authKeyring().delete(account),
  },
  redactor,
  probeConnection,
);
const notionConnection = new NotionConnection({
  workspace: workspaceIdentity(workspace),
  root: workspaceRoot,
  keyring: {
    get: (account) => authKeyring().get(account),
    set: (account, value) => authKeyring().set(account, value),
    delete: (account) => authKeyring().delete(account),
  },
  registerSecret: (value) => redactor.register(value),
  open: async (browser, url) => {
    await promisify(execFile)(
      "/usr/bin/open",
      notionBrowserArgs(browser, url),
      { timeout: 10000 },
    );
  },
});
const authMetadata = {
  list: (): Connection[] => {
    const row = workspace
      .prepare(
        "SELECT value_json FROM workspace_settings WHERE id='connections'",
      )
      .get() as { value_json: string } | undefined;
    const parsed: unknown = row ? JSON.parse(row.value_json) : [];
    if (!Array.isArray(parsed) || parsed.length > 100)
      throw Error("Invalid connections");
    return parsed.map((value) => connectionSchema.parse(value));
  },
  save: (connection: Connection) => {
    const values = authMetadata
      .list()
      .filter((value) => connectionId(value) !== connectionId(connection));
    values.push(connection);
    workspace
      .prepare(
        "INSERT INTO workspace_settings(id,value_json) VALUES ('connections',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
      )
      .run(JSON.stringify(values));
  },
  remove: (connection: Connection) => {
    const values = authMetadata
      .list()
      .filter((value) => connectionId(value) !== connectionId(connection));
    workspace
      .prepare(
        "UPDATE workspace_settings SET value_json=? WHERE id='connections'",
      )
      .run(JSON.stringify(values));
  },
};
const authSessions = new Set<AuthSession>();
const sessions = new Set<TerminalSession>();
let backupBusy = false;
process.parentPort?.on("message", (event) => {
  if (event.data?.kind === "backup") {
    const job = event.data;
    const request = backupRequest({
      action: job.action,
      password: job.password,
    });
    if (
      !request ||
      typeof job.id !== "string" ||
      typeof job.archive !== "string" ||
      typeof job.target !== "string" ||
      backupBusy
    )
      return;
    backupBusy = true;
    void (async () => {
      let ok = false;
      try {
        if (request.action === "export")
          await exportWorkspace(
            workspace,
            workspaceRoot!,
            job.archive,
            request.password,
            redactor,
          );
        else
          await restoreWorkspace(
            job.archive,
            job.target,
            request.password,
            requireNative(databaseModule!) as typeof Database,
          );
        ok = true;
        outputs.audit(
          "pm",
          request.action === "export" ? "backup.exported" : "backup.restored",
          "workspace",
          {},
        );
      } catch {
        /* No raw paths or passphrase errors cross IPC. */
      } finally {
        request.password = "";
        job.password = "";
        backupBusy = false;
        process.parentPort?.postMessage({
          kind: "backup-result",
          id: job.id,
          ok,
        });
      }
    })();
    return;
  }

  const port = event.ports[0];
  if (!port) return;
  const nativePi = new NativePiProcess(
    {
      binary: process.env.AMUN_PI_BINARY!,
      worker: process.env.AMUN_NATIVE_PI_WORKER!,
      entry: process.env.AMUN_PI_ENTRY!,
      root: process.env.AMUN_AUTH_ROOT!,
    },
    (event) => port.postMessage(event),
  );
  const auth = new AuthSession(
    authBroker,
    authMetadata,
    (event) => port.postMessage(event),
    startPiLogin(
      process.env.AMUN_PI_BINARY!,
      process.env.AMUN_AUTH_WORKER!,
      process.env.AMUN_PI_ENTRY!,
      process.env.AMUN_AUTH_ROOT!,
      (provider, url, selectedHost) =>
        process.parentPort?.postMessage({
          kind: "auth-browser",
          selectedHost,
          provider,
          url,
        }),
    ),
    (provider) =>
      checkPiReadiness(
        process.env.AMUN_PI_BINARY!,
        process.env.AMUN_PI_ENTRY!,
        process.env.AMUN_AUTH_ROOT!,
        provider,
      ),
  );
  authSessions.add(auth);
  let home: string | undefined;
  let pi: PiSession | undefined;
  let opening = false;
  let closed = false;
  let backendOpening = false;
  let backendEpoch = 0;
  let terminal = new TerminalSession(
    () => {
      const modulePath = process.env.AMUN_TERMINAL_MODULE;
      if (!modulePath) throw new Error("Terminal runtime unavailable");
      const native = requireNative(modulePath) as {
        spawn: (file: string, args: string[], options: unknown) => Pty;
      };
      home ??= mkdtempSync(join(tmpdir(), "amun-terminal-"));
      return native.spawn("/bin/bash", ["--noprofile", "--norc"], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: home,
        env: {
          HOME: home,
          PATH: "/usr/bin:/bin",
          TERM: "xterm-256color",
          LANG: "en_US.UTF-8",
          PS1: "amun-proof$ ",
        },
      });
    },
    (message) => port.postMessage(message),
  );
  sessions.add(terminal);
  const crew = new CrewObserver(
    async (id) => {
      const root = process.env.AMUN_CREW_RECEIPTS;
      const binary = process.env.AMUN_TMUX_BINARY;
      if (!root || !binary) return { endpoint: "unknown", worker: "unknown" };
      return observeOwnedTmux(root, id, binary, "m0");
    },
    (event) => port.postMessage(event),
  );
  port.on("message", (message) => {
    const response = handleHealthRequest(message.data);
    if (response) port.postMessage(response);
    else if (message.data?.kind === "workspace") {
      const reply = workspaceService.handle(message.data);
      if (reply) port.postMessage(reply);
    } else if (backendTerminalOpen.safeParse(message.data).success) {
      if (backendOpening) return;
      const request = backendTerminalOpen.parse(message.data);
      backendOpening = true;
      const epoch = ++backendEpoch;
      terminal.close();
      sessions.delete(terminal);
      const root = process.env.AMUN_CREW_RECEIPTS,
        binary = process.env.AMUN_TMUX_BINARY,
        modulePath = process.env.AMUN_TERMINAL_MODULE;
      if (!root || !binary || !modulePath) {
        backendOpening = false;
        return;
      }
      const native = requireNative(modulePath) as {
        spawn: (
          file: string,
          args: string[],
          options: unknown,
        ) => Pty & { pid: number };
      };
      void openBackendTerminal(
        root,
        request.taskId,
        binary,
        (file, args, options) => native.spawn(file, args, options),
      )
        .then((pty) => {
          if (closed || epoch !== backendEpoch) {
            pty.kill();
            return;
          }
          terminal = new TerminalSession(
            () => pty,
            (event) => port.postMessage(event),
          );
          sessions.add(terminal);
          terminal.handle({ version: 1, kind: "terminal", action: "open" });
        })
        .catch(() => {
          if (!closed)
            port.postMessage({
              version: 1,
              kind: "terminal-state",
              state: "unavailable",
            });
        })
        .finally(() => {
          backendOpening = false;
        });
    } else if (piOpen.safeParse(message.data).success) {
      if (opening || pi) return;
      opening = true;
      const binary = process.env.AMUN_PI_BINARY;
      const entry = process.env.AMUN_PI_ENTRY;
      if (!binary || !entry) {
        opening = false;
        return;
      }
      const request = piOpen.parse(message.data);
      void openPiProtocol(
        binary,
        entry,
        (event) => {
          if (!closed) port.postMessage(event);
        },
        request.action === "open-provider" ? request.provider : "protocol",
      )
        .then((session) => {
          if (closed) session.close();
          else pi = session;
        })
        .catch(() => {
          if (!closed)
            port.postMessage({
              version: 1,
              kind: "pi-state",
              state: "unavailable",
            });
        })
        .finally(() => {
          opening = false;
        });
    } else {
      nativePi.handle(message.data);
      const parsedAuth = authCommand.safeParse(message.data);
      if (
        parsedAuth.success &&
        ["notion-connect", "notion-check", "notion-cancel"].includes(
          parsedAuth.data.action,
        )
      ) {
        const command = parsedAuth.data;
        if (command.action === "notion-cancel") notionConnection.cancelLogin();
        else if (
          command.action === "notion-connect" ||
          command.action === "notion-check"
        ) {
          port.postMessage({
            version: 1,
            kind: "auth-status",
            id: "notion-mcp",
            status: "checking",
          });
          void notionConnection
            .connect(
              command.action === "notion-connect" ? command.browser : "edge",
              command.action === "notion-connect",
            )
            .then(() => {
              port.postMessage({
                version: 1,
                kind: "auth-status",
                id: "notion-mcp",
                status: "ready",
              });
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Notion MCP connected and its identity tool responded. Publishing still requires review.",
              });
            })
            .catch(() => {
              port.postMessage({
                version: 1,
                kind: "auth-status",
                id: "notion-mcp",
                status: "error",
              });
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Notion sign-in or access check did not complete. Reconnect in your selected browser; no content was published.",
              });
            });
        }
      } else void auth.handle(message.data);
      void crew.handle(message.data);
      if (
        backendOpening &&
        message.data?.kind === "terminal" &&
        message.data?.action === "close"
      )
        backendEpoch++;
      if (!backendOpening) terminal.handle(message.data);
      void pi?.handle(message.data);
      if (message.data?.kind === "pi" && message.data?.action === "close")
        pi = undefined;
    }
  });
  port.on("close", () => {
    closed = true;
    nativePi.close();
    auth.close();
    authSessions.delete(auth);
    crew.close();
    pi?.close();
    terminal.close();
    sessions.delete(terminal);
    if (home) rmSync(home, { recursive: true, force: true });
  });
  port.start();
});
process.on("exit", () => {
  for (const auth of authSessions) auth.close();
  workspace.close();
  for (const terminal of sessions) terminal.close();
});
