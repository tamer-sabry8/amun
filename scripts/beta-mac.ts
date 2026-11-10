import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error("This beta target requires an Apple-chip Mac");
if (process.env.AMUN_BETA !== "1" || process.env.AMUN_RELEASE === "1")
  throw Error("Select trusted tester beta mode exclusively");
const run = (file: string, args: string[]) =>
  execFileSync(file, args, { encoding: "utf8", maxBuffer: 4_000_000 });
const sourceCommit = run("git", ["rev-parse", "HEAD"]).trim();
const dirty = Boolean(run("git", ["status", "--porcelain"]));
const { version } = JSON.parse(
  readFileSync(
    new URL("../apps/desktop/package.json", import.meta.url),
    "utf8",
  ),
);
execFileSync("pnpm", ["--filter", "@amun/desktop", "package"], {
  stdio: "inherit",
});
const app = resolve("apps/desktop/out/Amun-darwin-arm64/Amun.app");
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
run("/usr/bin/codesign", [
  "--verify",
  "-R",
  'identifier "ai.amun.desktop"',
  app,
]);
const stage = mkdtempSync(join(tmpdir(), "amun-beta-dmg-"));
const output = resolve("../releases");
mkdirSync(output, { recursive: true });
const dmg = join(
  output,
  `Amun-${version}-beta-arm64-${sourceCommit.slice(0, 7)}.dmg`,
);
try {
  run("/usr/bin/ditto", [app, join(stage, "Amun.app")]);
  symlinkSync("/Applications", join(stage, "Applications"));
  writeFileSync(
    join(stage, "Beta information.txt"),
    "Amun trusted tester beta\n\nApple silicon (arm64). Ad-hoc signed; no Apple Developer ID signature or notarization. Developer ID signing and notarization are deferred by the owner to the final step of R2.\n\nDrag Amun to Applications, then open it. Keep this beta within the trusted tester group.\n\nPerformance and acceptance status: see the accompanying beta handoff and evidence. The 500 MiB memory budget remains unchanged.\n",
  );
  run("/usr/bin/hdiutil", [
    "create",
    "-volname",
    "Amun Beta",
    "-srcfolder",
    stage,
    "-format",
    "UDZO",
    dmg,
  ]);
  run("/usr/bin/codesign", ["--sign", "-", dmg]);
  run("/usr/bin/codesign", ["--verify", "--strict", dmg]);
  run("/usr/bin/hdiutil", ["verify", dmg]);
  const receipt = {
    artifact: dmg,
    sourceCommit,
    dirty,
    version,
    platform: "darwin",
    arch: "arm64",
    sha256: createHash("sha256").update(readFileSync(dmg)).digest("hex"),
    bundleId: "ai.amun.desktop",
    signature: "ad-hoc",
    developerIdSigned: false,
    notarized: false,
    audience: "trusted testers",
    signingAndNotarization:
      "deferred to final step of R2 by owner on 2026-11-10",
    launchAcceptance: "pending copy-out from this DMG",
  };
  writeFileSync(dmg + ".json", JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
