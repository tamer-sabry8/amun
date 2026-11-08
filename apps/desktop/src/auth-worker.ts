import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  PiLogin,
  type LoginRuntime,
} from "../../../packages/auth/src/login.ts";
import { Redactor } from "../../../packages/security/src/redaction.ts";
import { authCommand } from "../../../packages/contracts/src/auth.ts";
import { JsonLineDecoder } from "../../../packages/crew/src/jsonl.ts";
const root = process.env.AMUN_AUTH_ROOT,
  sdk = process.env.AMUN_AUTH_SDK;
if (!root || !sdk) throw Error("Auth worker configuration unavailable");
const send = (value: unknown) =>
  process.stdout.write(JSON.stringify(value) + "\n");
const flow = new PiLogin(root, new Redactor(), send, (url, selectedHost) =>
  send({ kind: "auth-browser", url, selectedHost }),
);
const decoder = new JsonLineDecoder(131072);
let running = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  try {
    for (const record of decoder.push(chunk)) {
      const command = authCommand.parse(record);
      if (command.action === "login" && !running) {
        running = true;
        void flow
          .run(command.provider, command.type, async (authPath) => {
            const module = (await import(pathToFileURL(sdk).href)) as {
              ModelRuntime: { create(options: unknown): Promise<LoginRuntime> };
            };
            return module.ModelRuntime.create({
              authPath,
              modelsPath: null,
              modelsStorePath: join(root, "models-cache.json"),
              allowModelNetwork: false,
              refreshOnCreate: false,
            });
          })
          .catch(() =>
            send({
              version: 1,
              kind: "auth-status",
              id: command.provider,
              status: "error",
            }),
          )
          .finally(() => {
            process.stdin.pause();
            process.exit(0);
          });
      } else if (command.action === "answer")
        flow.answer(command.id, command.answer);
      else if (command.action === "cancel") flow.cancel();
    }
  } catch {
    flow.cancel();
    process.exit(1);
  }
});
process.stdin.on("end", () => {
  flow.cancel();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flow.cancel();
  process.exit(0);
});
