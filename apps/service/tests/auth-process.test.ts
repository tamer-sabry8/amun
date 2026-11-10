import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startPiLogin } from "../src/auth-process.ts";

it("opens a provider prompt using only the Pi model runtime entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-login-entry-"));
  try {
    await mkdir(join(root, "core"));
    await writeFile(
      join(root, "core/model-runtime.js"),
      `
      export const ModelRuntime = {
        async create() {
          return { async login(provider, type, interaction) {
            await interaction.prompt({ type: "secret", message: "API key" });
          }};
        }
      };
    `,
    );
    const events: string[] = [];
    await new Promise<void>((done) => {
      const login = startPiLogin(
        process.execPath,
        resolve("apps/desktop/src/auth-worker.ts"),
        join(root, "bundle/cli.js"),
        join(root, "profile"),
        () => {},
      )(
        {
          version: 1,
          kind: "auth",
          action: "login",
          provider: "openai",
          type: "api_key",
        },
        (event) => {
          events.push(event.kind);
          if (event.kind === "auth-prompt") login.stop();
        },
        done,
      );
    });
    expect(events).toContain("auth-prompt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
