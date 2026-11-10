import type { DiagnosticEvent } from "../../../packages/contracts/src/diagnostic.ts";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { authEvent } from "../../../packages/contracts/src/auth.ts";
import { authBrowserUrl } from "../../../packages/auth/src/pi-auth.ts";
import type { StartLogin } from "../../../packages/auth/src/session.ts";
import { JsonLineDecoder } from "../../../packages/crew/src/jsonl.ts";
export function startPiLogin(
  binary: string,
  worker: string,
  entry: string,
  root: string,
  browser: (provider: string, url: string, selectedHost?: string) => void,
  record?: (event: DiagnosticEvent) => void,
): StartLogin {
  return (command, send, done) => {
    const started = performance.now();
    let measuredPrompt = false;
    const measure = (event: "login-worker-prompt" | "login-browser-handoff") =>
      record?.({
        version: 1,
        kind: "diagnostic",
        event,
        subject: command.provider,
        elapsedMs: Math.round(performance.now() - started),
      });
    const child = spawn(binary, [worker], {
      env: {
        HOME: root,
        PATH: "/usr/bin:/bin",
        ELECTRON_RUN_AS_NODE: "1",
        PI_CODING_AGENT_DIR: root,
        PI_SKIP_VERSION_CHECK: "1",
        AMUN_AUTH_ROOT: root,
        AMUN_AUTH_SDK: join(
          dirname(dirname(entry)),
          "core",
          "model-runtime.js",
        ),
        ...(process.env.NODE_EXTRA_CA_CERTS
          ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = new JsonLineDecoder(131072);
    let terminal = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.stdin.write(
        JSON.stringify({ version: 1, kind: "auth", action: "cancel" }) + "\n",
      );
      stopTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
      stopTimer.unref();
    };
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk: string) => {
      try {
        for (const frame of decoder.push(chunk)) {
          if (
            frame &&
            typeof frame === "object" &&
            "kind" in frame &&
            frame.kind === "auth-browser" &&
            "url" in frame &&
            typeof frame.url === "string"
          ) {
            browser(
              command.provider,
              authBrowserUrl(
                command.provider,
                frame.url,
                "selectedHost" in frame &&
                  typeof frame.selectedHost === "string"
                  ? frame.selectedHost
                  : undefined,
              ),
              "selectedHost" in frame && typeof frame.selectedHost === "string"
                ? frame.selectedHost
                : undefined,
            );
            measure("login-browser-handoff");
            continue;
          }
          const event = authEvent.parse(frame);
          if (
            event.kind === "auth-status" &&
            event.id === command.provider &&
            ["configured", "error", "cancelled"].includes(event.status)
          )
            terminal = true;
          if (event.kind === "auth-prompt" && !measuredPrompt) {
            measuredPrompt = true;
            measure("login-worker-prompt");
          }
          send(event);
        }
      } catch {
        stop();
      }
    });
    const finish = () => {
      clearTimeout(stopTimer);
      if (!terminal)
        send({
          version: 1,
          kind: "auth-status",
          id: command.provider,
          status: "error",
        });
      done();
    };
    child.once("error", finish);
    child.once("exit", finish);
    child.stdin.write(JSON.stringify(command) + "\n");
    return {
      answer: (id, value) => {
        if (!terminal)
          child.stdin.write(
            JSON.stringify({
              version: 1,
              kind: "auth",
              action: "answer",
              id,
              answer: value,
            }) + "\n",
          );
      },
      stop,
    };
  };
}
