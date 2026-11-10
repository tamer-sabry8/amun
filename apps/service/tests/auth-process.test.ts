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
    const measurements: object[] = [];
    await new Promise<void>((done) => {
      const login = startPiLogin(
        process.execPath,
        resolve("apps/desktop/src/auth-worker.ts"),
        join(root, "bundle/cli.js"),
        join(root, "profile"),
        () => {},
        (sample) => measurements.push(sample),
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
    expect(measurements).toEqual([
      {
        version: 1,
        kind: "diagnostic",
        event: "login-worker-prompt",
        subject: "openai",
        elapsedMs: expect.any(Number),
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
