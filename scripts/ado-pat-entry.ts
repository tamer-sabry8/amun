import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  adoCredential,
  validatePat,
} from "../packages/connectors-ado/src/keychain.ts";
// Secret travels only through a captured local pipe into native Keychain storage.
// It is never a command argument, file, environment variable, or console message.
try {
  if (process.platform !== "darwin") throw new Error();
  const { stdout } = await promisify(execFile)(
    "/usr/bin/osascript",
    [
      "-e",
      'text returned of (display dialog "Enter the Azure DevOps PAT for TahalufCollection / ICV. It will be stored in macOS Keychain for the local acceptance test. Do not enter it in chat." default answer "" with hidden answer buttons {"Cancel", "Save to Keychain"} default button "Save to Keychain" with title "Amun — Azure DevOps test connection")',
    ],
    { timeout: 600000, maxBuffer: 4096 },
  );
  await adoCredential().setPassword(validatePat(stdout.trim()));
  console.log("Azure DevOps test credential saved to macOS Keychain.");
} catch {
  console.error(
    "Credential entry cancelled or unavailable; no secret was logged.",
  );
  process.exitCode = 1;
}
