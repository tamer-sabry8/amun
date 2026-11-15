import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { helperExecutable, piBinary } from "../src/pi-runtime.ts";

const main = "/Applications/Amun.app/Contents/MacOS/Amun";
const helper =
  "/Applications/Amun.app/Contents/Frameworks/Amun Helper.app/Contents/MacOS/Amun Helper";

it("finds the helper that sits beside the main executable", () => {
  expect(helperExecutable(main)).toBe(helper);
  expect(helperExecutable("/usr/local/bin/electron")).toBeNull();
});

it("runs Pi from the helper in a packaged Mac app, so no worker is mistaken for the app", () => {
  expect(
    piBinary({
      packaged: true,
      platform: "darwin",
      execPath: main,
      executable: (path) => path === helper,
    }),
  ).toBe(helper);
});

it("keeps the running executable for development and other systems, or when the helper is not usable", () => {
  const usable = () => true;
  expect(
    piBinary({
      packaged: false,
      platform: "darwin",
      execPath: main,
      executable: usable,
    }),
  ).toBe(main);
  expect(
    piBinary({
      packaged: true,
      platform: "linux",
      execPath: "/opt/amun/amun",
      executable: usable,
    }),
  ).toBe("/opt/amun/amun");
  expect(
    piBinary({
      packaged: true,
      platform: "darwin",
      execPath: main,
      executable: () => false,
    }),
  ).toBe(main);
});

// Only where a packaged build exists in this worktree. Needs no sign-in or network.
const built = join(
  import.meta.dirname,
  "../out/Amun-darwin-arm64/Amun.app/Contents/MacOS/Amun",
);
const builtHelper = helperExecutable(built)!;
it.skipIf(!existsSync(builtHelper))(
  "the packaged helper runs Node code on its own",
  () => {
    const out = execFileSync(
      builtHelper,
      ["-e", "console.log(process.version)"],
      {
        env: { ELECTRON_RUN_AS_NODE: "1" },
        timeout: 20_000,
      },
    )
      .toString()
      .trim();
    expect(out).toMatch(/^v\d+\./);
  },
  30_000,
);
