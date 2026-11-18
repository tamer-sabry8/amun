// Amun: run as its own process (Electron in Node mode) to read the login
// shell's environment again and save it for the next launch. See
// amun-shell-env-cache.ts. It must not load "electron".
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import {
  SHELL_ENV_REFRESH_TARGET,
  shellEnvChanges,
  writeShellEnvCache,
} from "./amun-shell-env-cache.js";
import { resolveLoginShellEnvInto } from "./login-shell-env.js";

const target = process.env[SHELL_ENV_REFRESH_TARGET];
if (target) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[SHELL_ENV_REFRESH_TARGET];
  delete env.ELECTRON_RUN_AS_NODE;
  // Nobody is waiting here, so a slow interactive profile gets time to answer
  // (the launch path allows it 15 seconds; this allows it a minute).
  env.PASEO_SHELL_ENV_TIMEOUT_MS ??= "120000";
  const before = { ...env };
  const quiet = { info: () => undefined, warn: () => undefined };
  if (resolveLoginShellEnvInto({ env, logger: quiet, spawnSync, userInfo }))
    writeShellEnvCache(target, env.SHELL ?? null, shellEnvChanges(before, env));
}
