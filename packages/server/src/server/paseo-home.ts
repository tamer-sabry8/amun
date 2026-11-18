import os from "node:os";
import path from "node:path";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  // Amun: daemon state lives under ~/.amun/daemon unless PASEO_HOME or AMUN_HOME is set.
  const raw = env.PASEO_HOME ?? (env.AMUN_HOME ? path.join(env.AMUN_HOME, "daemon") : "~/.amun/daemon");
  const resolved = path.resolve(expandHomeDir(raw));
  return resolved;
}
