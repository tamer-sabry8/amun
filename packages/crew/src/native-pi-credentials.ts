import { randomUUID } from "node:crypto";
import type { NativePiResult } from "./native-pi.ts";
export interface CredentialSession {
  isStreaming: boolean;
  modelRuntime: {
    listCredentials(): Promise<readonly { providerId: string }[]>;
    logout(provider: string): Promise<void>;
  };
}
/** Construct only with the Amun-owned ModelRuntime, never an installed personal profile. */
export class NativePiCredentials {
  private confirmation:
    { id: string; provider: string; expires: number } | undefined;
  constructor(private readonly session: CredentialSession) {}
  async run(argument: string): Promise<NativePiResult> {
    if (
      this.session.isStreaming ||
      argument.length > 256 ||
      argument.includes("\0")
    ) {
      this.confirmation = undefined;
      throw Error("Busy session or invalid sign-out selection");
    }
    const credentials = await this.session.modelRuntime.listCredentials();
    if (
      credentials.length > 100 ||
      credentials.some((c) => !/^[-a-zA-Z0-9_.]{1,128}$/.test(c.providerId))
    )
      throw Error("Invalid provider catalog");
    if (argument.startsWith("confirm:")) {
      const pending = this.confirmation;
      this.confirmation = undefined;
      if (
        !pending ||
        pending.id !== argument ||
        pending.expires < Date.now() ||
        !credentials.some((c) => c.providerId === pending.provider)
      )
        throw Error("Sign-out confirmation expired or invalid");
      await this.session.modelRuntime.logout(pending.provider);
      return {
        kind: "message",
        text: `Signed out of ${pending.provider} in Amun’s private Pi profile. Personal CLI and Pi sign-ins are unchanged.`,
      };
    }
    this.confirmation = undefined;
    if (!argument)
      return {
        kind: "choices",
        title: "Choose an Amun Pi provider to sign out",
        choices: credentials.map((c) => ({
          id: c.providerId,
          label: c.providerId,
        })),
      };
    if (!credentials.some((c) => c.providerId === argument))
      throw Error("Unknown Amun provider");
    const id = "confirm:" + randomUUID();
    this.confirmation = {
      id,
      provider: argument,
      expires: Date.now() + 120_000,
    };
    return {
      kind: "choices",
      title: `Sign out of ${argument} in Amun? This removes its saved credential from Amun’s Pi profile.`,
      choices: [
        { id, label: "Confirm sign-out" },
        { id: "", label: "Cancel" },
      ],
    };
  }
}
