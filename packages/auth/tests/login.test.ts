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
it("uses the explicitly answered Copilot cloud tenant and rejects server URLs before device flow", async () => {
  for (const selected of [
    "https://tahaluf.ghe.com/",
    "https://ghes.tahaluf.ae/",
  ]) {
    const root = mkdtempSync(join(tmpdir(), "amun-host-login-"));
    const events: unknown[] = [];
    const urls: unknown[] = [];
    let reachedDevice = false;
    let flow: PiLogin;
    try {
      flow = new PiLogin(
        root,
        new Redactor(),
        (event) => {
          events.push(event);
          if (event.kind === "auth-prompt") flow.answer(event.id, selected);
        },
        (url, host) => urls.push({ url, host }),
      );
      await flow.run("github-copilot", "oauth", async () => ({
        login: async (_p, _t, interaction) => {
          await interaction.prompt({
            type: "text",
            message: "GitHub Enterprise URL/domain (blank for github.com)",
          });
          reachedDevice = true;
          interaction.notify({
            type: "device_code",
            verificationUri: "https://tahaluf.ghe.com/login/device",
            userCode: "TEST-CODE",
          });
        },
      }));
      if (selected.includes("tahaluf.ghe.com")) {
        expect(reachedDevice).toBe(true);
        expect(urls).toEqual([
          {
            url: "https://tahaluf.ghe.com/login/device",
            host: "tahaluf.ghe.com",
          },
        ]);
      } else {
        expect(reachedDevice).toBe(false);
        expect(urls).toEqual([]);
        expect(JSON.stringify(events)).toContain("No browser was opened.");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
