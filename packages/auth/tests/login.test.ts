import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiLogin } from "../src/login.ts";
import { Redactor } from "../../security/src/redaction.ts";
it("routes explicit prompts, rejects stale answers and opens only provider-owned auth URLs", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-login-"));
  const events: unknown[] = [];
  const urls: string[] = [];
  let flow: PiLogin;
  try {
    flow = new PiLogin(
      root,
      new Redactor(),
      (event) => {
        events.push(event);
        if (event.kind === "auth-prompt") {
          expect(flow.answer("stale", "secret")).toBe(false);
          expect(flow.answer(event.id, "chosen")).toBe(true);
        }
      },
      (url) => {
        urls.push(url);
      },
    );
    await flow.run("github-copilot", "oauth", async () => ({
      login: async (_provider, _type, interaction) => {
        interaction.notify({
          type: "auth_url",
          url: "https://github.com/login/device",
        });
        expect(
          await interaction.prompt({
            type: "select",
            message: "Pick",
            options: [{ id: "chosen", label: "Chosen" }],
          }),
        ).toBe("chosen");
        return { access: "CANARY-never-forwarded" };
      },
    }));
    expect(urls).toEqual(["https://github.com/login/device"]);
    expect(JSON.stringify(events)).not.toContain("CANARY");
    expect(events).toContainEqual({
      version: 1,
      kind: "auth-status",
      id: "github-copilot",
      status: "configured",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("cancels pending sign-in and refuses unsupported or unsafe runtime interaction", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-login-"));
  const events: unknown[] = [];
  let flow: PiLogin;
  try {
    flow = new PiLogin(
      root,
      new Redactor(),
      (event) => {
        events.push(event);
        if (event.kind === "auth-prompt") flow.cancel();
      },
      () => {
        throw Error("Must not open");
      },
    );
    await flow.run("openrouter", "oauth", async () => ({
      login: async (_p, _t, interaction) =>
        interaction.prompt({ type: "secret", message: "Key" }),
    }));
    expect(events).toContainEqual({
      version: 1,
      kind: "auth-status",
      id: "openrouter",
      status: "cancelled",
    });
    expect(flow.answer("stale", "value")).toBe(false);
    await expect(
      flow.run("anthropic", "oauth", async () => {
        throw Error();
      }),
    ).rejects.toThrow();
    await flow.run("github-copilot", "oauth", async () => ({
      login: async (_p, _t, interaction) => {
        interaction.notify({ type: "auth_url", url: "https://attacker.test" });
      },
    }));
    expect(events).toContainEqual({
      version: 1,
      kind: "auth-status",
      id: "github-copilot",
      status: "error",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
