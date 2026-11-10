import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

if (process.platform !== "darwin") throw Error("Mac release requires macOS");
const config = createRequire(import.meta.url)(
  "../apps/desktop/forge.config.cjs",
);
const signing = config.packagerConfig.osxSign;
const notarization = config.packagerConfig.osxNotarize;
if (!signing || !notarization)
  throw Error(
    "Run with AMUN_RELEASE=1 and the selected signing identity and notary profile",
  );
const run = (file: string, args: string[]) =>
  execFileSync(file, args, { encoding: "utf8", maxBuffer: 4_000_000 });
run("git", ["diff", "--quiet"]);
run("git", ["diff", "--cached", "--quiet"]);
const sourceCommit = run("git", ["rev-parse", "HEAD"]).trim();
const { version } = JSON.parse(
  readFileSync(
    new URL("../apps/desktop/package.json", import.meta.url),
    "utf8",
  ),
);
const identities = run("/usr/bin/security", [
  "find-identity",
  "-v",
  "-p",
  "codesigning",
]);
if (!identities.includes('"' + signing.identity + '"'))
  throw Error(
    "The selected Developer ID Application identity is not installed and valid",
  );
run("/usr/bin/xcrun", ["--find", "notarytool"]);
// Validate the locally stored credentials before staging or packaging the runtime.
run("/usr/bin/xcrun", [
  "notarytool",
  "history",
  "--keychain-profile",
  notarization.keychainProfile,
  "--output-format",
  "json",
]);
execFileSync("pnpm", ["package"], { stdio: "inherit" });

const app = resolve(`apps/desktop/out/Amun-darwin-${process.arch}/Amun.app`);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
run("/usr/bin/xcrun", ["stapler", "validate", app]);
run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
const team = signing.identity.match(/\(([A-Z0-9]{10})\)$/)![1];
run("/usr/bin/codesign", [
  "--verify",
  "-R",
  `identifier "ai.amun.desktop" and anchor apple generic and certificate leaf[subject.OU] = "${team}"`,
  app,
]);
const stage = mkdtempSync(join(tmpdir(), "amun-release-"));
const dmg = resolve(
  `apps/desktop/out/Amun-${version}-${process.arch}-${sourceCommit.slice(0, 7)}.dmg`,
);
try {
  run("/usr/bin/ditto", [app, join(stage, "Amun.app")]);
  symlinkSync("/Applications", join(stage, "Applications"));
  run("/usr/bin/hdiutil", [
    "create",
    "-volname",
    "Amun",
    "-srcfolder",
    stage,
    "-format",
    "UDZO",
    dmg,
  ]);
  run("/usr/bin/codesign", ["--sign", signing.identity, "--timestamp", dmg]);
  const result = JSON.parse(
    run("/usr/bin/xcrun", [
      "notarytool",
      "submit",
      dmg,
      "--keychain-profile",
      notarization.keychainProfile,
      "--wait",
      "--output-format",
      "json",
    ]),
  );
  if (result.status !== "Accepted")
    throw Error("Apple did not accept the DMG notarization");
  run("/usr/bin/xcrun", ["stapler", "staple", dmg]);
  run("/usr/bin/xcrun", ["stapler", "validate", dmg]);
  run("/usr/bin/codesign", ["--verify", "--strict", dmg]);
  run("/usr/sbin/spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=2",
    dmg,
  ]);
  const receipt = {
    artifact: dmg,
    sha256: createHash("sha256").update(readFileSync(dmg)).digest("hex"),
    bundleId: "ai.amun.desktop",
    sourceCommit,
    team,
    notarization: { id: result.id, status: result.status },
    cleanAccountInstall: "pending physical acceptance",
  };
  writeFileSync(dmg + ".json", JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
