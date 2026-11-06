import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  selectedCredential,
  InferenceEvidence,
  selectedCopilotCredential,
} from "../packages/crew/src/pi-inference.ts";
import { PiRpcClient } from "../packages/crew/src/pi-rpc.ts";
const provider = process.argv[2];
if (!provider || !["github-copilot", "openrouter"].includes(provider))
  throw new Error("Select github-copilot or openrouter");
const packaged = process.argv.includes("--packaged");
const model =
  process.argv.find((arg) => arg.startsWith("--model="))?.slice(8) ??
  (provider === "openrouter" ? "openai/gpt-4.1-mini" : "gpt-5.4-nano");
let personalBefore: string | undefined;
const root = await mkdtemp(join(tmpdir(), "amun-inference-"));
try {
  const installed = join(
    homedir(),
    ".pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
  );
  const config = join(root, "config");
  await mkdir(config, { mode: 0o700 });
  let credential: { name: string; value: string } | undefined;
  if (provider === "github-copilot") {
    // Pi's public SDK reads exactly the explicitly selected provider. OAuth's
    // own endpoint/refresh logic runs only against this disposable 0600 store.
    const sdk = (await import(
      pathToFileURL(
        join(
          homedir(),
          ".pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
        ),
      ).href
    )) as { readStoredCredential: (provider: string, path: string) => unknown };
    const authPath = join(homedir(), ".pi/agent/auth.json");
    personalBefore = createHash("sha256")
      .update(await readFile(authPath))
      .digest("hex");
    const selected = selectedCopilotCredential(
      sdk.readStoredCredential(provider, authPath),
    );
    await writeFile(
      join(config, "auth.json"),
      JSON.stringify({ [provider]: selected }),
      { mode: 0o600, flag: "wx" },
    );
  } else {
    let output: string;
    try {
      output = (
        await promisify(execFile)(
          process.execPath,
          [
            installed,
            "auth",
            "check",
            "--provider",
            provider,
            "--json",
            "--credentials",
            "--no-refresh",
          ],
          { cwd: root, timeout: 20000, maxBuffer: 65536 },
        )
      ).stdout;
    } catch {
      throw new Error("Provider credential unavailable");
    }
    credential = selectedCredential(provider, output);
    output = "";
  }
  await writeFile(
    join(config, "settings.json"),
    JSON.stringify({ retry: { enabled: false } }),
    { mode: 0o600 },
  );
  const resources = resolve(
    `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/Resources`,
  );
  const binary = packaged
    ? resolve(
        `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
      )
    : process.execPath;
  const entry = packaged
    ? join(
        resources,
        "pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js",
      )
    : resolve(
        "runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js",
      );
  const env: NodeJS.ProcessEnv = {
    HOME: root,
    PATH: "",
    PI_CODING_AGENT_DIR: config,
    PI_SKIP_VERSION_CHECK: "1",
    ...(credential ? { [credential.name]: credential.value } : {}),
  };
  if (packaged) env.ELECTRON_RUN_AS_NODE = "1";
  if (process.env.NODE_EXTRA_CA_CERTS)
    env.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS;
  const child = spawn(
    binary,
    [
      entry,
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--provider",
      provider,
      "--model",
      model,
    ],
    { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (credential) {
    delete env[credential.name];
    credential.value = "";
  }
  const run = new InferenceEvidence();
  let stopReason = "unobserved";
  let providerStatus: string | undefined;
  let finish: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const client = new PiRpcClient(
    (line) => {
      child.stdin.write(line);
    },
    (frame) => {
      if (
        frame.type === "message_end" &&
        frame.message &&
        typeof frame.message === "object"
      ) {
        const message = frame.message as Record<string, unknown>;
        if (message.role === "assistant") {
          if (
            ["stop", "error", "aborted", "length", "toolUse"].includes(
              String(message.stopReason),
            )
          )
            stopReason = String(message.stopReason);
          if (typeof message.errorMessage === "string")
            providerStatus = message.errorMessage.match(
              /\b(400|401|403|404|429|500|502|503)\b/,
            )?.[1];
        }
      }
      run.accept(frame);
      if (run.complete || run.failed) finish();
    },
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => client.receive(chunk));
  child.stderr.resume();
  child.on("error", () => {
    client.close();
    finish();
  });
  child.on("exit", () => {
    client.close();
    finish();
  });
  child.stdin.on("error", () => {
    client.close();
    finish();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const models = (await client.request("get_available_models")) as {
      models?: { provider: string; id: string }[];
    };
    const count =
      models.models?.filter((m) => m.provider === provider).length ?? 0;
    if (process.argv.includes("--list-models")) {
      console.log(
        JSON.stringify({
          provider,
          metadataOnly: true,
          models: models.models
            ?.filter((m) => m.provider === provider)
            .map((m) => m.id),
        }),
      );
    } else {
      if (
        !models.models?.some((m) => m.provider === provider && m.id === model)
      )
        throw new Error("Selected model not offered by provider");
      await client.request("prompt", {
        message: "Reply with exactly AMUN_OK. Do not use tools.",
      });
      await Promise.race([
        settled,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 60000);
        }),
      ]);
      if (!run.complete || run.failed || run.text.trim() !== "AMUN_OK") {
        console.log(
          JSON.stringify({
            provider,
            model,
            packaged,
            complete: run.complete,
            failed: run.failed,
            streamDeltas: run.deltas,
            stopReason,
            providerStatus,
          }),
        );
        throw new Error("Inference proof incomplete or unsuccessful");
      }
      console.log(
        JSON.stringify({
          provider,
          model,
          packaged,
          isolatedState: true,
          emptyPath: true,
          models: count,
          streamDeltas: run.deltas,
          successfulAssistantStop: true,
          agentSettled: true,
          expectedReply: true,
          credentialStored:
            provider === "github-copilot"
              ? "temporary selected OAuth only; removed after proof"
              : false,
          personalRefresh: false,
        }),
      );
    }
  } finally {
    clearTimeout(timer);
    client.close();
    child.kill();
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    if (
      child.exitCode === null &&
      child.signalCode === null &&
      child.pid !== undefined
    )
      await new Promise<void>((done) => child.once("exit", () => done()));
    clearTimeout(force);
  }
} catch (error) {
  console.error(
    error instanceof Error &&
      [
        "Provider credential unavailable",
        "Inference proof incomplete or unsuccessful",
      ].includes(error.message)
      ? error.message
      : "Inference proof failed; runtime details withheld",
  );
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  if (personalBefore) {
    const after = createHash("sha256")
      .update(await readFile(join(homedir(), ".pi/agent/auth.json")))
      .digest("hex");
    console.log(
      JSON.stringify({
        personalCredentialFileUnchanged: after === personalBefore,
      }),
    );
    if (after !== personalBefore) process.exitCode = 1;
  }
}
