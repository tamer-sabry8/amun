import { it, expect, vi } from "vitest";
import { resetServiceUI } from "../src/service-loss.ts";
it("revokes terminal input, clears pending dialogs and marks dependent views unavailable", () => {
  const terminal = { options: { disableStdin: false } };
  const dialog = { replaceChildren: vi.fn(), textContent: "old" };
  const labels = {
    "crew-observation": { textContent: "endpoint verified" },
    "pi-status": { textContent: "running" },
    "terminal-status": { textContent: "control" },
    "pi-dialog": dialog,
  };
  resetServiceUI((id) => labels[id as keyof typeof labels] ?? null, terminal);
  expect(terminal.options.disableStdin).toBe(true);
  expect(labels["crew-observation"].textContent).toBe("unknown");
  expect(dialog.replaceChildren).toHaveBeenCalledOnce();
  expect(labels["pi-status"].textContent).toBe("unavailable");
  expect(labels["terminal-status"].textContent).toBe("unavailable");
  expect(() => resetServiceUI(() => null, terminal)).not.toThrow();
});
