import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { authEvent, type AuthEvent } from "../../contracts/src/auth.ts";
import type { Redactor } from "../../security/src/redaction.ts";
import { preparePiAuth, validateLogin, authBrowserUrl } from "./pi-auth.ts";
import { withRefreshLock } from "./broker.ts";
export interface Prompt {
  type: "text" | "secret" | "manual_code" | "select";
  message: string;
  options?: readonly { id: string; label: string }[];
  signal?: AbortSignal;
}
export interface Interaction {
  signal: AbortSignal;
  prompt(prompt: Prompt): Promise<string>;
  notify(event: {
    type: string;
    url?: string;
    message?: string;
    userCode?: string;
    verificationUri?: string;
  }): void;
}
export interface LoginRuntime {
  login(
    provider: string,
    type: "oauth" | "api_key",
    interaction: Interaction,
    options?: { agentName: string; getDeviceId: () => string },
  ): Promise<unknown>;
}
export class PiLogin {
  private readonly root: string;
  private readonly redactor: Redactor;
  private readonly send: (event: AuthEvent) => void;
  private readonly browser: (url: string) => void;
  private controller: AbortController | undefined;
  private pending:
    | {
        id: string;
        resolve: (value: string) => void;
        reject: (error: Error) => void;
        prompt: Prompt;
      }
    | undefined;
  constructor(
    root: string,
    redactor: Redactor,
    send: (event: AuthEvent) => void,
    browser: (url: string) => void,
  ) {
    this.root = root;
    this.redactor = redactor;
    this.send = (event) => send(authEvent.parse(event));
    this.browser = browser;
  }
  answer(id: string, value: string): boolean {
    const pending = this.pending;
    if (!pending || pending.id !== id || value.length > 65536) return false;
    if (
      pending.prompt.type === "select" &&
      !pending.prompt.options?.some((option) => option.id === value)
    )
      return false;
    if (
      pending.prompt.type === "secret" ||
      pending.prompt.type === "manual_code"
    )
      if (value) this.redactor.register(value);
    this.pending = undefined;
    pending.resolve(value);
    return true;
  }
  cancel(): void {
    this.controller?.abort();
    this.pending?.reject(Error("Login cancelled"));
    this.pending = undefined;
  }
  async run(
    provider: string,
    type: "oauth" | "api_key",
    create: (authPath: string) => Promise<LoginRuntime>,
  ): Promise<void> {
    validateLogin(provider, type);
    if (this.controller) throw Error("Login already in progress");
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => this.cancel(), 300000);
    timer.unref();
    this.send({
      version: 1,
      kind: "auth-status",
      id: provider,
      status: "checking",
    });
    try {
      const authPath = await preparePiAuth(this.root);
      await withRefreshLock(this.root, async () => {
        if (controller.signal.aborted) throw Error("Cancelled");
        const devicePath = join(this.root, "device-id");
        let device: string;
        try {
          device = await readFile(devicePath, "utf8");
          if (!/^[a-f0-9-]{36}$/.test(device))
            throw Error("Invalid device identity");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          device = randomUUID();
          await writeFile(devicePath, device, { mode: 0o600, flag: "wx" });
        }
        const runtime = await create(authPath);
        await runtime.login(
          provider,
          type,
          {
            signal: controller.signal,
            prompt: (prompt) =>
              new Promise<string>((resolve, reject) => {
                if (
                  controller.signal.aborted ||
                  prompt.signal?.aborted ||
                  this.pending
                ) {
                  reject(Error("Prompt unavailable"));
                  return;
                }
                const id = randomUUID();
                const abort = () => {
                  if (this.pending?.id === id) {
                    this.pending = undefined;
                    reject(Error("Prompt cancelled"));
                  }
                };
                const cleanup = () => {
                  controller.signal.removeEventListener("abort", abort);
                  prompt.signal?.removeEventListener("abort", abort);
                };
                this.pending = {
                  id,
                  prompt,
                  resolve: (value) => {
                    cleanup();
                    resolve(value);
                  },
                  reject: (error) => {
                    cleanup();
                    reject(error);
                  },
                };
                controller.signal.addEventListener("abort", abort, {
                  once: true,
                });
                prompt.signal?.addEventListener("abort", abort, { once: true });
                try {
                  this.send({
                    version: 1,
                    kind: "auth-prompt",
                    id,
                    method: prompt.type,
                    message: this.redactor.text(prompt.message).slice(0, 4096),
                    options: (prompt.options ?? []).map((option) => ({
                      id: option.id,
                      label: this.redactor.text(option.label),
                    })),
                  });
                } catch {
                  this.pending = undefined;
                  cleanup();
                  reject(Error("Invalid login prompt"));
                }
              }),
            notify: (event) => {
              if (event.type === "auth_url" && event.url)
                this.browser(authBrowserUrl(provider, event.url));
              else if (
                event.type === "device_code" &&
                event.verificationUri &&
                event.userCode
              ) {
                if (!/^[A-Za-z0-9-]{1,64}$/.test(event.userCode))
                  throw Error("Invalid device code");
                this.browser(authBrowserUrl(provider, event.verificationUri));
                this.send({
                  version: 1,
                  kind: "auth-notice",
                  message:
                    "Enter this device code in the browser: " + event.userCode,
                });
              } else if (
                (event.type === "info" || event.type === "progress") &&
                event.message
              )
                this.send({
                  version: 1,
                  kind: "auth-notice",
                  message: this.redactor.text(event.message).slice(0, 4096),
                });
            },
          },
          { agentName: "Amun", getDeviceId: () => device },
        );
        await preparePiAuth(this.root);
      });
      if (controller.signal.aborted) throw Error("Cancelled");
      this.send({
        version: 1,
        kind: "auth-status",
        id: provider,
        status: "configured",
      });
    } catch {
      this.send({
        version: 1,
        kind: "auth-status",
        id: provider,
        status: controller.signal.aborted ? "cancelled" : "error",
      });
    } finally {
      clearTimeout(timer);
      this.pending?.reject(Error("Login ended"));
      this.pending = undefined;
      this.controller = undefined;
    }
  }
}
