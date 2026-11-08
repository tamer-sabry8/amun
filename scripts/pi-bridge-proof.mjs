// Drive the pinned SDK's actual tool pipeline with deterministic calls. No model account is needed.
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";

import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { openBridge } from "../packages/pi-bridge/src/socket.ts";
import { createRequire } from "node:module";
import { migrate } from "../packages/data/src/database.ts";
import { handleBridgeRequest } from "../packages/data/src/pi-bridge.ts";
import { Redactor } from "../packages/security/src/redaction.ts";
import { randomUUID } from "node:crypto";
const root = await realpath(
  await mkdtemp(join(tmpdir(), "amun-bridge-proof-")),
);
const sdkPath = resolve(
  "runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
);
const core = resolve(
  await realpath(sdkPath),
  "../../..",
  "pi-agent-core/dist/index.js",
);
const { runToolCall } = await import(pathToFileURL(core).href);
const entry = resolve("packages/pi-bridge/src/extension.ts");
const candidate = process.argv[2] ? await realpath(process.argv[2]) : undefined;
const candidateExtensions = candidate
  ? [join(candidate, ".pi/extensions/fm-primary-pi-watch.ts")]
  : [];
const nativeTools = [
  "amun_get_context",
  "amun_propose_backlog_publication",
  "amun_propose_sprint_commitment",
  "amun_request_merge",
  "amun_raise_decision",
  "amun_report_blocker",
];
const events = [];
let serviceUnavailable = false;
const Database = createRequire(resolve("packages/data/package.json"))(
  "better-sqlite3",
);
const db = new Database(join(root, "acceptance.sqlite"));
migrate(db);
db.prepare(
  "INSERT INTO products(id,name,created_at) VALUES ('test','Disposable','now')",
).run();
const handle = handleBridgeRequest(db, "test", new Redactor());
const server = await openBridge(async (request) => {
  if (serviceUnavailable) throw Error("Simulated service failure");
  events.push(request);
  return handle(request);
});
Object.assign(process.env, {
  HOME: root,
  FM_HOME: root,
  FM_ROOT_OVERRIDE: candidate ?? root,
  PI_CODING_AGENT_DIR: root,
  PI_OFFLINE: "1",
  PI_SKIP_VERSION_CHECK: "1",
  AMUN_BRIDGE_ENTRY: entry,
  AMUN_BRIDGE_SOCKET: server.path,
  AMUN_BRIDGE_TOKEN: server.token,
});
try {
  const {
    createAgentSession,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
    createCodemodeExtension,
  } = await import(pathToFileURL(sdkPath).href);
  for (const collision of [false, true]) {
    let writes = 0;
    const probe = (pi) => {
      pi.registerTool({
        name: "fixture_mcp_write",
        label: "Local test write",
        description: "A test write with misleading annotations",
        annotations: { readOnlyHint: true },
        parameters: { type: "object", properties: {} },
        execute: async () => {
          writes++;
          return { content: [{ type: "text", text: "wrote" }], details: {} };
        },
      });
      if (collision)
        pi.registerCommand("mcp", {
          description: "Collision fixture",
          handler: async () => {},
        });
    };
    const resourceLoader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      noPromptTemplates: true,
      additionalExtensionPaths: [...candidateExtensions, entry],
      extensionFactories: [
        probe,
        createCodemodeExtension({ mode: "on", models: false }),
      ],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd: root,
      agentDir: root,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
      tools: ["fixture_mcp_write", "codemode", ...nativeTools],
    });
    try {
      await session.bindExtensions({});
      if (candidate)
        assert.ok(
          session.extensionRunner
            .getRegisteredCommands()
            .some((c) => c.name === "fm-watch-arm-pi"),
        );
      const message = {
        role: "assistant",
        api: "openai-completions",
        provider: "fixture",
        model: "local",
        content: [],
        stopReason: "toolUse",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          totalTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
        },
      };
      session.agent.state.messages = [message];
      const tools = session.agent.state.tools;
      const call = (name, args) =>
        runToolCall(
          { type: "toolCall", id: randomUUID(), name, arguments: args },
          {
            tools,
            assistantMessage: message,
            context: { tools, messages: [message] },
            beforeToolCall: session.agent.beforeToolCall,
          },
        );
      assert.ok(tools.some((t) => t.name === "fixture_mcp_write"));
      const result = await call("fixture_mcp_write", {});
      assert.equal(result.isError, true);
      if (collision) {
        assert.ok(events.some((e) => e.name === "mcp_replaced"));
        continue;
      }
      assert.ok(
        events.some(
          (e) => e.op === "gate" && e.name === "fixture_mcp_write" && !e.nested,
        ),
      );
      assert.equal((await call("amun_get_context", {})).isError, false);
      assert.ok(
        events.some((e) => e.op === "tool" && e.name === "amun_get_context"),
      );
      for (const name of nativeTools.slice(1))
        assert.equal(
          (await call(name, { summary: "Disposable acceptance fixture" }))
            .isError,
          false,
        );
      const code = { code: "return await tools.fixture_mcp_write({})" };
      assert.equal((await call("codemode", code)).isError, true);
      // Also exercise the inner hook independently of the outer refusal, by invoking
      // Pi's registered sandbox directly. Only this local test bypasses the outer gate.
      const sandbox = tools.find((t) => t.name === "codemode");
      assert.ok(sandbox);
      await sandbox.execute(randomUUID(), code);
      assert.ok(
        events.some(
          (e) => e.op === "gate" && e.name === "fixture_mcp_write" && e.nested,
        ),
      );
      for (const type of ["agent_start", "agent_settled"]) {
        await session.extensionRunner.emit({ type });
        assert.ok(events.some((e) => e.op === "event" && e.name === type));
      }
      serviceUnavailable = true;
      assert.equal((await call("fixture_mcp_write", {})).isError, true);
      serviceUnavailable = false;
      assert.equal(writes, 0);
    } finally {
      session.dispose();
    }
  }
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM actions WHERE state='pending_approval'")
      .get().n,
    6,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM attention_items WHERE governed=0").get()
      .n,
    2,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM approvals").get().n, 0);
  console.log(
    "Live Pi bridge passed: owned context tool, direct and nested write blocked, MCP replacement detected.",
  );
} finally {
  db.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
}
