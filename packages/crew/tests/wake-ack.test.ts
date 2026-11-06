import { it, expect } from "vitest";
import { wakeAcknowledgement } from "../src/wake-ack.ts";
it("accepts only one bounded Firstmate acknowledgement instruction", () => {
  expect(
    wakeAcknowledgement(
      "WAKE_ACK_REQUIRED: after handling completes run bin/fm-wake-drain.sh --ack-through 2 --recovery-generation 123.abc\n",
    ),
  ).toEqual(["--ack-through", "2", "--recovery-generation", "123.abc"]);
  for (const text of [
    "WAKE_ACK_REQUIRED: after handling completes run bin/fm-wake-drain.sh --ack-through 2 --recovery-generation x\n".repeat(
      2,
    ),
    "",
    "noise --ack-through 2 --recovery-generation ok",
    "WAKE_ACK_REQUIRED: after handling completes run bin/fm-wake-drain.sh --ack-through 2 --recovery-generation $(bad)",
    "x".repeat(65537),
  ])
    expect(() => wakeAcknowledgement(text)).toThrow();
});
