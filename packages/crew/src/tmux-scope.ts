import { mkdtemp, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

// Reserve room for /tmux-<uid>/default within macOS's 104-byte sockaddr_un path.
const maxRootBytes = 70;
function validateScope(scope: string): void {
  if (
    !isAbsolute(scope) ||
    scope.includes("\0") ||
    Buffer.byteLength(scope) > maxRootBytes
  )
    throw new Error("Use a short absolute tmux socket directory");
}
/** Allocate once per managed runtime; retain its address for later reconnects. */
export async function createTmuxScope(parent = "/tmp"): Promise<string> {
  const canonical = await realpath(parent);
  const prefix = join(canonical, "amun-tmux-");
  validateScope(`${prefix}XXXXXX`);
  // mkdtemp creates an exclusive directory with mode 0700.
  return mkdtemp(prefix);
}
/** Explicit launch allowlist: never inherit ambient session selectors or shell hooks. */
export function tmuxEnvironment(
  scope: string,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  validateScope(scope);
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "HOME",
    "PATH",
    "FM_HOME",
    "FM_ROOT_OVERRIDE",
    "PI_CODING_AGENT_DIR",
    "PI_SKIP_VERSION_CHECK",
    "PI_OFFLINE",
    "ELECTRON_RUN_AS_NODE",
  ]) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return {
    ...env,
    TMUX_TMPDIR: scope,
    FM_BACKEND: "tmux",
    TERM: "xterm-256color",
  };
}
