/** Why a message waits: no provider is connected, or a turn is still out. */
export type WaitReason = "provider" | "busy";

/** Messages saved by older builds carry no reason and wait for a provider. */
export const waitReason = (held: { reason?: WaitReason | undefined }) =>
  held.reason === "busy" ? "busy" : "provider";

/** Only a provider wait shows the connect alert and its buttons. */
export const waitParts = (reason: WaitReason) => ({
  tag: true,
  providerAlert: reason === "provider",
});
