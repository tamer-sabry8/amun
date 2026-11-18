/** Where connection secrets live. macOS Keychain in the app; memory in tests. */
export interface SecretStore {
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export class SecretStoreTimeoutError extends Error {
  constructor(public readonly operation: string) {
    super(`Keychain did not answer the ${operation} in time`);
    this.name = "SecretStoreTimeoutError";
  }
}

const KEYCHAIN_SERVICE = "ai.amun";
const KEYCHAIN_TIMEOUT_MS = 20_000;

function withTimeout<T>(operation: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SecretStoreTimeoutError(operation)), KEYCHAIN_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * OS credential store through @napi-rs/keyring's async API, so a Keychain
 * prompt never blocks the daemon. Every call is bounded by a timeout.
 */
export function keychainSecretStore(service: string = KEYCHAIN_SERVICE): SecretStore {
  async function entry(account: string) {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    return new AsyncEntry(service, account);
  }
  return {
    async get(account) {
      const found = await withTimeout("read", entry(account).then((e) => e.getPassword()));
      return found ?? undefined;
    },
    async set(account, secret) {
      await withTimeout("save", entry(account).then((e) => e.setPassword(secret)));
    },
    async delete(account) {
      await withTimeout(
        "delete",
        entry(account).then((e) => e.deleteCredential()),
      );
    },
  };
}

export function memorySecretStore(): SecretStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(account) {
      return values.get(account);
    },
    async set(account, secret) {
      values.set(account, secret);
    },
    async delete(account) {
      values.delete(account);
    },
  };
}
