import { assertRuntimeContained } from "../packages/crew/src/runtime-links.ts";
import { resolve, join } from "node:path";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const directory = resolve(
  `apps/desktop/out/Amun-${process.platform}-${process.arch}`,
);
const binary =
  process.platform === "darwin"
    ? join(directory, "Amun.app/Contents/MacOS/Amun")
    : join(directory, "Amun");
const resources =
  process.platform === "darwin"
    ? join(directory, "Amun.app/Contents/Resources")
    : join(directory, "resources");
const entry = join(
  resources,
  "pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js",
);
await access(binary);
await access(entry);
await assertRuntimeContained(join(resources, "pi"));
await assertRuntimeContained(join(resources, "terminal"));
await assertRuntimeContained(join(resources, "database"));
// The probe harness uses developer Node; the Pi child uses only the packaged Electron binary.
const runtime = spawnSync(
  process.execPath,
  ["scripts/pi-proof.ts", entry, binary],
  { stdio: "inherit", timeout: 25000 },
);
if (runtime.error) throw runtime.error;
if (runtime.status !== 0) process.exit(runtime.status ?? 1);
await assertRuntimeContained(join(resources, "firstmate"));
const firstmate = spawnSync(
  process.execPath,
  ["scripts/firstmate-proof.ts", join(resources, "firstmate"), entry, binary],
  { stdio: "inherit", timeout: 30000 },
);
if (firstmate.error) throw firstmate.error;
if (firstmate.status !== 0) process.exit(firstmate.status ?? 1);
const e2e = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test"],
  {
    stdio: "inherit",
    timeout: 90000,
    env: { ...process.env, AMUN_PACKAGED_PATH: binary },
  },
);
if (e2e.error) throw e2e.error;
process.exit(e2e.status ?? 1);
