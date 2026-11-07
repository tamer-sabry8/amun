import { it, expect } from "vitest";
import { macKeyring } from "../src/keyring.ts";
it("constrains the native Keychain service and account scope", () => {
  const values = new Map<string, string>();
  const adapter = macKeyring(
    class {
      private key: string;
      constructor(service: string, account: string) {
        expect(service).toBe("ai.amun");
        this.key = account;
      }
      getPassword() {
        return values.get(this.key) ?? null;
      }
      setPassword(value: string) {
        values.set(this.key, value);
      }
      deletePassword() {
        return values.delete(this.key);
      }
    },
  );
  const account = "workspace/github-" + "a".repeat(32);
  expect(adapter.get(account)).toBeUndefined();
  adapter.set(account, "secret");
  expect(adapter.get(account)).toBe("secret");
  adapter.delete(account);
  expect(adapter.get(account)).toBeUndefined();
  expect(() => adapter.get("../personal")).toThrow();
});
