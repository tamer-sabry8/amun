import { accessSync, constants } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * The executable that runs Pi (ELECTRON_RUN_AS_NODE) for Firstmate's crew.
 *
 * Run from the main executable, a worker that outlives the window is
 * registered by macOS as the app itself (bundle id ai.amun.desktop), and a
 * newly installed Amun cannot open until that process is stopped. The
 * bundled helper is the same Electron runtime under its own bundle id
 * (ai.amun.desktop.helper, background-only), so it never stands in for the
 * app. Fuses and signatures are untouched.
 */
export function helperExecutable(main: string) {
  const macos = dirname(main);
  if (basename(macos) !== "MacOS" || basename(dirname(macos)) !== "Contents")
    return null;
  const name = basename(main);
  return join(
    dirname(macos),
    "Frameworks",
    `${name} Helper.app`,
    "Contents",
    "MacOS",
    `${name} Helper`,
  );
}

export function piBinary(input: {
  packaged: boolean;
  platform: string;
  execPath: string;
  executable?(path: string): boolean;
}) {
  const executable =
    input.executable ??
    ((path: string) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (!input.packaged || input.platform !== "darwin") return input.execPath;
  const helper = helperExecutable(input.execPath);
  return helper && executable(helper) ? helper : input.execPath;
}
