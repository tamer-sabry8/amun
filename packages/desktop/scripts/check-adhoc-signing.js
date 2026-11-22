const { spawnSync } = require("node:child_process");

// An ad-hoc signature with hardened runtime makes macOS refuse to load the
// separately signed Electron Framework at launch ("mapping process and mapped
// file (non-platform) have different Team IDs"), so the app crashes before
// any Amun code runs. Ad-hoc beta builds must be signed with hardened runtime
// off; Developer ID builds keep it on.
function describeAdhocRuntimeConflict(codesignDetails) {
  const isAdhoc = /^Signature=adhoc$/m.test(codesignDetails);
  const flags = /^CodeDirectory .*flags=0x[0-9a-f]+\(([^)]*)\)/m.exec(
    codesignDetails,
  );
  const hasRuntime = flags !== null && flags[1].split(",").includes("runtime");
  if (!isAdhoc || !hasRuntime) {
    return null;
  }
  return (
    "This build is ad-hoc signed with hardened runtime on, so macOS will refuse to " +
    "load Electron Framework and the app will crash at launch. Build the beta with " +
    "`npm run dist:mac:beta` (or pass -c.mac.hardenedRuntime=false with -c.mac.identity=-)."
  );
}

function assertAdhocSigningLaunchable(appPath) {
  // codesign -dv writes its report to stderr.
  const result = spawnSync("codesign", ["-dv", "--verbose=2", appPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `codesign could not read the signature of ${appPath}: ${result.stderr}`,
    );
  }
  const problem = describeAdhocRuntimeConflict(result.stderr);
  if (problem !== null) {
    throw new Error(problem);
  }
}

module.exports = { describeAdhocRuntimeConflict, assertAdhocSigningLaunchable };
