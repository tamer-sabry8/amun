import { _electron as electron } from "@playwright/test";
export function launchMacWorkspace(root: string) {
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  return electron.launch({
    args: [
      ...(executablePath ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(executablePath ? { executablePath } : {}),
  });
}
