import type { Keyring } from "./broker.ts";
export interface EntryLike {
  getPassword(): string | null;
  setPassword(value: string): void;
  deletePassword(): boolean;
}
export function assertKeychainAccount(account: string): void {
  if (
    !/^[a-zA-Z0-9_-]{1,128}\/(ado|github|notion|cloudflare|obsidian)-[a-f0-9]{32}$/.test(
      account,
    )
  )
    throw Error("Invalid Keychain account");
}
export function macKeyring(
  Entry: new (service: string, account: string) => EntryLike,
): Keyring {
  const entry = (account: string) => {
    assertKeychainAccount(account);
    return new Entry("ai.amun", account);
  };
  return {
    get: (account) => entry(account).getPassword() ?? undefined,
    set: (account, value) => entry(account).setPassword(value),
    delete: (account) => {
      entry(account).deletePassword();
    },
  };
}
