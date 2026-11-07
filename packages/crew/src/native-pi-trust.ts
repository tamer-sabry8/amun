import type { NativePiResult } from "./native-pi.ts";
export interface TrustStore {
  get(path: string): boolean | null;
  set(path: string, value: boolean | null): void;
}
export class NativePiTrust {
  constructor(
    private store: TrustStore,
    private cwd: string,
  ) {}
  run(argument: string): NativePiResult {
    if (!argument)
      return {
        kind: "choices",
        title:
          "Trust this Amun workspace? Trusted project resources may execute code when loaded.",
        choices: [
          { id: "trust", label: "Trust this workspace only" },
          { id: "deny", label: "Do not trust this workspace" },
          { id: "ask", label: "Clear decision; ask next time" },
        ],
      };
    if (!["trust", "deny", "ask"].includes(argument))
      throw Error("Invalid trust decision");
    const value = argument === "ask" ? null : argument === "trust";
    this.store.set(this.cwd, value);
    if (this.store.get(this.cwd) !== value)
      throw Error("Trust decision was not saved");
    return {
      kind: "message",
      text: "Trust decision saved for this Amun workspace. Loaded resources are unchanged until reload.",
    };
  }
}
