import { crewList } from "../../../packages/contracts/src/crew.ts";
import { listReceiptTasks } from "../../../packages/crew/src/endpoint-receipt.ts";
import {
  readHosting,
  saveHosting,
} from "../../../packages/data/src/hosting-destination.ts";
import {
  cloudflareConsentArgs,
  inspectCloudflareHosting,
} from "../../../packages/auth/src/cloudflare-hosting.ts";
import {
  GithubDeviceLogin,
  githubDevicePost,
  githubGrant,
} from "../../../packages/auth/src/github-device.ts";
import {
  GithubReadFailure,
  checkGithubMcp,
  createGithubIssue,
} from "../../../packages/auth/src/github-mcp.ts";
import { GithubIssueReview } from "../../../packages/data/src/github-issue.ts";
import { createHash } from "node:crypto";
import { NotionConversationReview } from "../../../packages/data/src/notion-review.ts";
import {
  nativePiCommand,
  nativePiEvent,
  notionApprovalRequest,
  type NativePiEvent,
} from "../../../packages/contracts/src/native-pi.ts";
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
let cloudflareBusy = false;
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
  let notionPreview: { title: string; text: string; at: number } | undefined;
  let notionReviewBusy = false;
  const notionReviews = new NotionConversationReview(workspace, {
    create: async (input, context) => {
      const row = workspace
        .prepare(
          "SELECT value_json FROM workspace_settings WHERE id='notion.destination'",
        )
        .get() as { value_json: string } | undefined;
      if (!row) throw Error("Notion destination missing");
      const target = await notionConnection.inspectTarget(
        JSON.parse(row.value_json) as string,
      );
      if (
        target.parentId !== input.parentId ||
        target.parentType !== input.parentType ||
        target.titleProperty !== input.titleProperty
      )
        throw Error("Destination changed; review again");
      return notionConnection.publish(input, context.workspaceId);
    },
  });
  const sendNative = (id: string, result: NativePiEvent["result"]) =>
    port.postMessage(
      nativePiEvent.parse({ version: 1, kind: "native-pi-result", id, result }),
    );
  const githubAccount =
    workspaceIdentity(workspace) +
    "/" +
    connectionId({ kind: "github", baseUrl: "https://api.githubcopilot.com" });
  const githubLogin = new GithubDeviceLogin(
    githubDevicePost,
    async () => {
      await promisify(execFile)(
        "/usr/bin/open",
        ["-a", "Microsoft Edge", "https://github.com/login/device"],
        { timeout: 10000 },
      );
    },
    (grant) => {
      redactor.register(grant.access_token);
      if (grant.refresh_token) redactor.register(grant.refresh_token);
      authKeyring().set(
        githubAccount,
        JSON.stringify({ grant, savedAt: Date.now() }),
      );
    },
  );
  const nativePi = new NativePiProcess(
    {
      binary: process.env.AMUN_PI_BINARY!,
      worker: process.env.AMUN_NATIVE_PI_WORKER!,
      entry: process.env.AMUN_PI_ENTRY!,
      root: process.env.AMUN_AUTH_ROOT!,
    },
    (event) => {
      if (event.result.kind === "notion-preview") {
        notionPreview = {
          title: redactor.text(event.result.title),
          text: redactor.text(event.result.text),
          at: Date.now(),
        };
      }
      if (event.result.kind === "notion-preview" && notionPreview) {
        port.postMessage({
          ...event,
          result: {
            ...event.result,
            title: notionPreview.title,
            text: notionPreview.text,
            contentHash: createHash("sha256")
              .update(JSON.stringify([notionPreview.title, notionPreview.text]))
              .digest("hex"),
          },
        });
      } else if (event.result.kind === "conversation") {
        port.postMessage({
          ...event,
          result: {
            ...event.result,
            title: redactor.text(event.result.title),
            text: redactor.text(event.result.text),
          },
        });
      } else port.postMessage(event);
    },
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
  let listingCrew = false;
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
    else if (crewList.safeParse(message.data).success) {
      if (listingCrew) return;
      listingCrew = true;
      const root = process.env.AMUN_CREW_RECEIPTS;
      void (root ? listReceiptTasks(root) : Promise.resolve(null))
        .catch(() => null)
        .then((tasks) => {
          if (!closed)
            port.postMessage({ version: 1, kind: "crew-inventory", tasks });
        })
        .finally(() => {
          listingCrew = false;
        });
    } else if (message.data?.kind === "workspace") {
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
      const nativeRequest = nativePiCommand.safeParse(message.data);
      if (nativeRequest.success && nativeRequest.data.action === "run") {
        const request = nativeRequest.data;
        if (
          request.command === "hosting-save" ||
          (request.command === "mcp" &&
            request.argument === "cloudflare-hosting")
        ) {
          try {
            const destination =
              request.command === "hosting-save"
                ? saveHosting(workspace, JSON.parse(request.argument))
                : readHosting(workspace);
            sendNative(request.id, { kind: "hosting-setup", destination });
          } catch {
            sendNative(request.id, {
              kind: "message",
              text: "Hosting destination could not be saved or loaded. Enter a DNS hostname within your selected zone.",
            });
          }
          return;
        }
      }
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "run" &&
        nativeRequest.data.command === "mcp" &&
        nativeRequest.data.argument === "cloudflare-hosting-check"
      ) {
        const id = nativeRequest.data.id;
        const target = readHosting(workspace);
        if (target?.provider !== "cloudflare") {
          sendNative(id, { kind: "hosting-setup", destination: target });
          return;
        }
        if (cloudflareBusy) {
          sendNative(id, {
            kind: "message",
            text: "Cloudflare authorization is in progress.",
          });
          return;
        }
        cloudflareBusy = true;
        const account =
          workspaceIdentity(workspace) +
          "/cloudflare-" +
          createHash("sha256")
            .update("https://mcp.cloudflare.com/mcp")
            .digest("hex")
            .slice(0, 32);
        void inspectCloudflareHosting(
          {
            read: () => authKeyring().get(account),
            write: (value) => authKeyring().set(account, value),
            registerSecret: (value) => redactor.register(value),
            open: async (url) => {
              await promisify(execFile)(
                "/usr/bin/open",
                cloudflareConsentArgs(url),
                { timeout: 10000 },
              );
            },
          },
          target.zone,
          target.host,
        )
          .then((records) => {
            if (!closed)
              sendNative(id, {
                kind: "message",
                text:
                  "Cloudflare Code Mode verified " +
                  target.zone +
                  ". DNS records for " +
                  target.host +
                  ": " +
                  records +
                  ".",
              });
          })
          .catch(() => {
            if (!closed)
              sendNative(id, {
                kind: "message",
                text: "Cloudflare hosting inspection incomplete. Verify the account, consent and zone access.",
              });
          })
          .finally(() => {
            cloudflareBusy = false;
          });
        return;
      }
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "run" &&
        nativeRequest.data.command === "github-issue-publish"
      ) {
        const cmd = nativeRequest.data;
        void (async () => {
          const approval = notionApprovalRequest.parse(
            JSON.parse(cmd.argument),
          );
          const stored = JSON.parse(authKeyring().get(githubAccount) ?? "null");
          const token = githubGrant.parse(stored?.grant);
          if (
            !Number.isFinite(stored.savedAt) ||
            (token.expires_in &&
              Date.now() >= stored.savedAt + token.expires_in * 1000)
          )
            throw Error("Expired");
          const review = new GithubIssueReview(workspace);
          const outcome = await review.publish(
            approval.reviewId,
            approval.binding,
            (issue) => createGithubIssue(token.access_token, issue),
          );
          if (!closed)
            sendNative(cmd.id, {
              kind: "message",
              text:
                outcome === "succeeded"
                  ? "GitHub issue created: https://github.com/tamer-sabry8/amun/issues/" +
                    review.receipt(approval.reviewId)
                  : "Issue creation is unconfirmed. Check GitHub before any further write.",
            });
        })().catch(() => {
          if (!closed)
            sendNative(cmd.id, {
              kind: "message",
              text: "GitHub approval could not be used. Check the issue and saved connection.",
            });
        });
        return;
      }
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "run" &&
        nativeRequest.data.command === "mcp" &&
        [
          "github-repo-connect",
          "github-connect",
          "github-open",
          "github-finish",
          "github-cancel",
          "github-read",
          "github-issue-review",
        ].includes(nativeRequest.data.argument)
      ) {
        const cmd = nativeRequest.data;
        void (async () => {
          const showCode = () =>
            sendNative(cmd.id, {
              kind: "github-device",
              code: githubLogin.userCode!,
            });
          if (
            cmd.argument === "github-connect" ||
            cmd.argument === "github-repo-connect"
          ) {
            await githubLogin.start(
              cmd.argument === "github-repo-connect" ? "repo" : "public_repo",
            );
            showCode();
            return;
          }
          if (cmd.argument === "github-open") {
            await githubLogin.openBrowser();
            showCode();
            return;
          }
          if (cmd.argument === "github-cancel") {
            githubLogin.cancel();
            sendNative(cmd.id, {
              kind: "message",
              text: "GitHub sign-in cancelled.",
            });
            return;
          }
          if (
            cmd.argument === "github-finish" &&
            (await githubLogin.check()) === "pending"
          ) {
            showCode();
            return;
          }
          if (cmd.argument === "github-issue-review") {
            const receipt = new GithubIssueReview(workspace).completedIssue();
            if (receipt) {
              sendNative(cmd.id, {
                kind: "message",
                text:
                  "Previously created GitHub issue: https://github.com/tamer-sabry8/amun/issues/" +
                  receipt,
              });
              return;
            }
          }
          const stored = authKeyring().get(githubAccount);
          if (!stored) {
            sendNative(cmd.id, {
              kind: "message",
              text: "GitHub is disconnected. Choose Sign in with Microsoft Edge to connect.",
            });
            return;
          }
          const { grant, savedAt } = JSON.parse(stored);
          const token = githubGrant.parse(grant);
          if (
            typeof savedAt !== "number" ||
            (token.expires_in &&
              Date.now() >= savedAt + 1000 * token.expires_in)
          ) {
            sendNative(cmd.id, {
              kind: "message",
              text: "GitHub sign-in has expired. Reconnect with Microsoft Edge.",
            });
            return;
          }
          if (cmd.argument === "github-issue-review") {
            const review = new GithubIssueReview(workspace);
            try {
              sendNative(cmd.id, {
                kind: "github-issue-review",
                ...review.prepare(),
              });
            } catch {
              sendNative(cmd.id, {
                kind: "message",
                text: "This workspace already submitted or changed this issue. Inspect GitHub before any further write.",
              });
            }
            return;
          }
          await checkGithubMcp(token.access_token);
          sendNative(cmd.id, {
            kind: "message",
            text: "GitHub MCP connected. Read package.json from tamer-sabry8/amun.",
          });
        })().catch((error: unknown) => {
          if (!closed)
            sendNative(cmd.id, {
              kind: "message",
              text:
                error instanceof GithubReadFailure
                  ? error.message
                  : "GitHub operation could not be verified. Check the saved connection or start a new sign-in.",
            });
        });
        return;
      }
      if (
        nativeRequest.success &&
        nativeRequest.data.action === "run" &&
        ["notion-review", "notion-publish", "notion-receipts"].includes(
          nativeRequest.data.command,
        )
      ) {
        const command = nativeRequest.data;
        if (notionReviewBusy) {
          sendNative(command.id, {
            kind: "message",
            text: "Wait for the current Notion review operation.",
          });
          return;
        }
        notionReviewBusy = true;
        void (async () => {
          if (command.command === "notion-receipts") {
            sendNative(command.id, {
              kind: "publication-receipts",
              pages: notionReviews
                .receipts()
                .map((page) => ({ ...page, title: redactor.text(page.title) })),
            });
          } else if (command.command === "notion-publish") {
            const approval = notionApprovalRequest.parse(
              JSON.parse(command.argument),
            );
            const outcome = await notionReviews.publish(
              approval.reviewId,
              approval.binding,
            );
            sendNative(command.id, {
              kind: "message",
              text:
                outcome === "succeeded"
                  ? "The reviewed conversation was published as a new Notion page."
                  : "Publication outcome is unconfirmed. Do not retry; reconciliation is required to avoid a duplicate page.",
            });
          } else {
            const preview = notionPreview;
            if (!preview || Date.now() - preview.at > 600000)
              throw Error("Conversation preview expired");
            const row = workspace
              .prepare(
                "SELECT value_json FROM workspace_settings WHERE id='notion.destination'",
              )
              .get() as { value_json: string } | undefined;
            if (!row) {
              sendNative(command.id, {
                kind: "message",
                text: "First check your Notion destination in Settings → Connections. Nothing has been published.",
              });
              return;
            }
            const target = await notionConnection.inspectTarget(
              JSON.parse(row.value_json) as string,
            );
            const identity = notionConnection.identity;
            if (!identity) throw Error("Notion workspace unavailable");
            const review = notionReviews.prepare(
              {
                title: redactor.text(preview.title),
                text: redactor.text(preview.text),
              },
              target,
              identity.workspaceId,
            );
            sendNative(command.id, {
              kind: "notion-review",
              reviewId: review.id,
              binding: review.binding,
              title: review.title,
              text: review.text,
              destination: review.destination,
              destinationId: target.parentId,
            });
          }
        })()
          .catch(() =>
            sendNative(command.id, {
              kind: "message",
              text:
                command.command === "notion-publish"
                  ? "Publication could not be confirmed. Do not retry until its outcome has been checked."
                  : "Amun could not prepare this Notion review. Check the destination and connection, then preview the conversation again. Nothing was published.",
            }),
          )
          .finally(() => {
            notionReviewBusy = false;
          });
        return;
      }
      if (nativeRequest.success) notionPreview = undefined;
      nativePi.handle(message.data);
      const parsedAuth = authCommand.safeParse(message.data);
      if (
        parsedAuth.success &&
        [
          "notion-connect",
          "notion-check",
          "notion-cancel",
          "notion-disconnect",
          "notion-target",
        ].includes(parsedAuth.data.action)
      ) {
        const command = parsedAuth.data;
        if (command.action === "notion-target") {
          void notionConnection
            .inspectTarget(command.url)
            .then((destination) => {
              workspace
                .prepare(
                  "INSERT INTO workspace_settings(id,value_json) VALUES ('notion.destination',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
                )
                .run(JSON.stringify(command.url));
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message: redactor.text(
                  `Notion verified ${destination.title} (${destination.parentType === "data_source_id" ? "database" : "page"}). Publication is still blocked until content and destination are reviewed.`,
                ),
              });
            })
            .catch(() =>
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Amun could not verify this Notion destination. Check its link and workspace access. Nothing was published.",
              }),
            );
        } else if (command.action === "notion-disconnect") {
          notionPreview = undefined;
          void notionConnection
            .disconnect()
            .then(() => {
              workspace
                .prepare(
                  "DELETE FROM workspace_settings WHERE id='notion.destination'",
                )
                .run();
              port.postMessage({
                version: 1,
                kind: "auth-status",
                id: "notion-mcp",
                status: "missing",
              });
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Notion disconnected from this Amun workspace. Saved credentials and destination were removed. Existing Notion pages are unchanged. Manage server-side access in Notion if you also want to revoke the grant.",
              });
            })
            .catch(() => {
              port.postMessage({
                version: 1,
                kind: "auth-notice",
                message:
                  "Notion disconnect could not be completed. Your connection status has not been confirmed.",
              });
            });
        } else if (command.action === "notion-cancel")
          notionConnection.cancelLogin();
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
                message: redactor.text(
                  `Notion MCP connected to ${notionConnection.identity?.workspaceName ?? "your workspace"}. Publishing still requires review.`,
                ),
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
    githubLogin.cancel();
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
