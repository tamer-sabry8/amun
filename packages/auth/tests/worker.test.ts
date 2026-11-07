import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("real auth worker transports only validated prompts/status and saves the secret in its private Pi file", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-auth-worker-"));
  const sdk = join(root, "sdk.mjs");
  writeFileSync(
    sdk,
    `import {writeFile} from 'node:fs/promises';export const ModelRuntime={create:async({authPath})=>({login:async(provider,type,interaction)=>{const key=await interaction.prompt({type:'secret',message:'API key'});await writeFile(authPath,JSON.stringify({[provider]:{type:'api_key',key}}),{mode:0o600});return {key};}})};`,
  );
  const secret = "CANARY-only-private-auth-store";
  let output = "";
  let errors = "";
  const child = spawn(process.execPath, ["apps/desktop/src/auth-worker.ts"], {
    env: {
      HOME: root,
      PATH: "/usr/bin:/bin",
      AMUN_AUTH_ROOT: join(root, "pi"),
      AMUN_AUTH_SDK: sdk,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    let buffer = "";
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const event = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (event.kind === "auth-prompt")
          child.stdin.write(
            JSON.stringify({
              version: 1,
              kind: "auth",
              action: "answer",
              id: event.id,
              answer: secret,
            }) + "\n",
          );
      }
    });
    child.stdin.write(
      JSON.stringify({
        version: 1,
        kind: "auth",
        action: "login",
        provider: "openai",
        type: "api_key",
      }) + "\n",
    );
    const [code] = await once(child, "exit");
    expect(code, errors).toBe(0);
    expect(output).toContain("configured");
    expect(output).not.toContain(secret);
    expect(errors).not.toContain(secret);
    const file = join(root, "pi", "auth.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain(secret);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
