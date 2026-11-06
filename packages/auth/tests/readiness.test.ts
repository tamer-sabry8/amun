import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPiReadiness } from "../src/readiness.ts";
it("runs only the supported scoped JSON check under a lock and returns no raw credential output", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-readiness-"));
  try {
    let calls = 0;
    const run = async (
      binary: string,
      args: string[],
      options: { env: NodeJS.ProcessEnv },
    ) => {
      calls++;
      expect(binary).toBe("/safe/node");
      expect(args).toEqual([
        "/safe/pi",
        "auth",
        "check",
        "--provider",
        "openrouter",
        "--json",
      ]);
      expect(options.env.PI_CODING_AGENT_DIR).toBe(root);
      expect(options.env.OPENROUTER_API_KEY).toBeUndefined();
      return '{"provider":"openrouter","status":"ready"}';
    };
    expect(
      await checkPiReadiness("/safe/node", "/safe/pi", root, "openrouter", run),
    ).toBe("configured");
    expect(calls).toBe(1);
    expect(
      await checkPiReadiness("/safe/node", "/safe/pi", root, "arbitrary", run),
    ).toBe("error");
    expect(calls).toBe(1);
    expect(
      await checkPiReadiness(
        "/safe/node",
        "/safe/pi",
        root,
        "openrouter",
        async () =>
          '{"provider":"openrouter","status":"not_ready","reason":"credentials_not_configured"}',
      ),
    ).toBe("missing");
    expect(
      await checkPiReadiness(
        "/safe/node",
        "/safe/pi",
        root,
        "openrouter",
        async () => {
          throw Error("secret");
        },
      ),
    ).toBe("error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
