import { describe, expect, it } from "vitest";
import { maintenanceCommand } from "../src/branch-maintenance.ts";
describe("unattended maintenance", () => {
  it("admits the pinned drain and its sequence and generation acknowledgement", () => {
    for (const input of [
      "bin/fm-wake-drain.sh",
      "bin/fm-wake-drain.sh --ack-through 2 --recovery-generation 12.gen",
    ])
      expect(maintenanceCommand(input)).toBe(input);
  });
  it("rejects compound commands, arbitrary reads, unrelated executables and unbound arguments", () => {
    for (const input of [
      "cat notes",
      "git push",
      "bin/fm-wake-drain.sh\ntrue",
      "bin/fm-wake-drain.sh --ack-through -1 --recovery-generation 3",
      "bin/fm-wake-drain.sh; echo hi",
      "bin/fm-wake-drain.sh > output",
    ])
      expect(() => maintenanceCommand(input)).toThrow();
  });
});
