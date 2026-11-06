/** Parse data from the pinned drain protocol; never execute its printed shell text. */
export function wakeAcknowledgement(text: string): string[] {
  if (text.length > 65536) throw Error("Oversized wake drain");
  const matches = [
    ...text.matchAll(
      /^WAKE_ACK_REQUIRED: after handling completes run bin\/fm-wake-drain\.sh --ack-through (0|[1-9][0-9]{0,14}) --recovery-generation ([A-Za-z0-9._-]{1,128})$/gm,
    ),
  ];
  if (matches.length !== 1)
    throw Error("Missing or ambiguous wake acknowledgement");
  return [
    "--ack-through",
    matches[0]![1]!,
    "--recovery-generation",
    matches[0]![2]!,
  ];
}
