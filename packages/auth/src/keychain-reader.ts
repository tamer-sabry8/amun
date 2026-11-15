import { Worker } from "node:worker_threads";
import { assertKeychainAccount } from "./keyring.ts";

export const keychainWaitingNote =
  "Waiting for permission to use your saved sign-in. Check for a macOS prompt.";

/** The Keychain did not answer in time; the read may still finish later. */
export class KeychainTimeout extends Error {
  constructor() {
    super(keychainWaitingNote);
  }
}

export interface KeychainTransport {
  post(request: { id: number; account: string }): void;
  onReply(
    listener: (reply: {
      id: number;
      value?: string | null;
      error?: true;
    }) => void,
  ): void;
}

/**
 * Reads credentials without ever blocking the caller. The native Keychain call
 * is synchronous and waits for the macOS authorization prompt, so it runs in
 * its own thread; a prompt left unanswered stalls only this reader.
 */
export class KeychainReader {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve(value: string | undefined): void;
      reject(error: unknown): void;
    }
  >();
  constructor(
    private readonly transport: KeychainTransport,
    private readonly options: {
      /** Called once per read that is still unanswered after waitingMs. */
      onWaiting?: () => void;
      waitingMs?: number;
      timeoutMs?: number;
    } = {},
  ) {
    transport.onReply((reply) => {
      const entry = this.pending.get(reply.id);
      if (!entry) return;
      this.pending.delete(reply.id);
      if (reply.error) entry.reject(Error("Keychain read failed"));
      else entry.resolve(reply.value ?? undefined);
    });
  }
  get(account: string): Promise<string | undefined> {
    assertKeychainAccount(account);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timers: NodeJS.Timeout[] = [];
      const finish = () => timers.forEach(clearTimeout);
      this.pending.set(id, {
        resolve: (value) => (finish(), resolve(value)),
        reject: (error) => (finish(), reject(error)),
      });
      const {
        onWaiting,
        waitingMs = 10_000,
        timeoutMs = 60_000,
      } = this.options;
      if (onWaiting) timers.push(setTimeout(onWaiting, waitingMs).unref());
      timers.push(
        setTimeout(() => {
          this.pending.delete(id);
          reject(new KeychainTimeout());
        }, timeoutMs).unref(),
      );
      this.transport.post({ id, account });
    });
  }
}

const workerSource = `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const native = createRequire(workerData.base)(workerData.module);
parentPort.on("message", ({ id, account }) => {
  try {
    const value = new native.Entry("ai.amun", account).getPassword();
    parentPort.postMessage({ id, value: value ?? null });
  } catch {
    parentPort.postMessage({ id, error: true });
  }
});
`;

/** The real transport: one thread that owns every Keychain read. */
export function keychainWorker(
  modulePath: string,
  base: string,
): KeychainTransport {
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: { module: modulePath, base },
  });
  worker.unref();
  return {
    post: (request) => worker.postMessage(request),
    onReply: (listener) => worker.on("message", listener),
  };
}

/** Test-only: reads that never answer, like an unanswered macOS prompt. */
export const hangingKeychain: KeychainTransport = {
  post: () => undefined,
  onReply: () => undefined,
};
