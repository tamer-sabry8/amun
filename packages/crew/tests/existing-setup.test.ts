import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectExistingSetup,
  assertIsolatedStatePath,
} from "../src/existing-setup.js";

let root: string;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  root = await realpath(await mkdtemp(join(tmpdir(), "amun-existing-")));
  const pi = join(root, "installed-pi");
  const home = join(root, "personal-firstmate");
  const config = join(root, "personal-pi");
  await mkdir(pi);
  await mkdir(join(home, "state"), { recursive: true });
  await mkdir(config);
  await writeFile(
    join(pi, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: "1.4.0",
    }),
  );
  await writeFile(join(config, "auth.json"), "PRIVATE-CANARY");
  await writeFile(join(home, "state/.lock"), `${process.pid}\n`);
  return {
    piPackageDirectory: pi,
    firstmateHome: home,
    piConfigDirectory: config,
    amunStateDirectory: join(root, "amun"),
  };
}

describe("existing installation coexistence", () => {
  it("reports a live PID as possibly running, without taking over or exposing credentials", async () => {
    const input = await fixture();
    const before = await readFile(
      join(input.firstmateHome, "state/.lock"),
      "utf8",
    );
    const report = await inspectExistingSetup(input);
    expect(report.piVersion).toBe("1.4.0");
    expect(report.versionMatchesBaseline).toBe(true);
    expect(report.compatibility).toBe("requires_rpc_probe");
    expect(report.firstmateSession).toBe("possibly_running");
    expect(report.reuseMode).toBe("installed_tools_isolated_state");
    expect(report.attachSupported).toBe(false);
    expect(JSON.stringify(report)).not.toContain("PRIVATE-CANARY");
    expect(
      await readFile(join(input.piConfigDirectory, "auth.json"), "utf8"),
    ).toBe("PRIVATE-CANARY");
    expect(
      await readFile(join(input.firstmateHome, "state/.lock"), "utf8"),
    ).toBe(before);
  });
  it("keeps newer versions unverified rather than overwriting or downgrading them", async () => {
    const input = await fixture();
    const contents = JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: "9.0.0",
    });
    await writeFile(join(input.piPackageDirectory, "package.json"), contents);
    const report = await inspectExistingSetup(input);
    expect(report.versionMatchesBaseline).toBe(false);
    expect(report.compatibility).toBe("requires_rpc_probe");
    expect(
      await readFile(join(input.piPackageDirectory, "package.json"), "utf8"),
    ).toBe(contents);
  });
  it("treats missing or malformed lock evidence as uncertain, not permission to start another captain", async () => {
    const input = await fixture();
    await rm(join(input.firstmateHome, "state/.lock"));
    expect((await inspectExistingSetup(input)).firstmateSession).toBe(
      "not_observed",
    );
    await writeFile(join(input.firstmateHome, "state/.lock"), "PRIVATE-CANARY");
    const report = await inspectExistingSetup(input);
    expect(report.firstmateSession).toBe("unknown");
    expect(report.attachSupported).toBe(false);
    expect(JSON.stringify(report)).not.toContain("PRIVATE-CANARY");
  });
  it("refuses a different package or executable-looking version string", async () => {
    const input = await fixture();
    await writeFile(
      join(input.piPackageDirectory, "package.json"),
      '{"name":"other","version":"1.4.0"}',
    );
    await expect(inspectExistingSetup(input)).rejects.toThrow();
    await writeFile(
      join(input.piPackageDirectory, "package.json"),
      '{"name":"@earendil-works/pi-coding-agent","version":"$(command)"}',
    );
    await expect(inspectExistingSetup(input)).rejects.toThrow();
  });
  it("rejects state directories overlapping existing code, configuration or a running home", async () => {
    const input = await fixture();
    for (const protectedPath of [
      input.piPackageDirectory,
      input.piConfigDirectory,
      input.firstmateHome,
    ]) {
      await expect(
        assertIsolatedStatePath(protectedPath, [protectedPath]),
      ).rejects.toThrow();
      await expect(
        assertIsolatedStatePath(join(protectedPath, "amun"), [protectedPath]),
      ).rejects.toThrow();
      await expect(
        assertIsolatedStatePath(root, [protectedPath]),
      ).rejects.toThrow();
    }
    await expect(
      inspectExistingSetup({
        ...input,
        amunStateDirectory: input.firstmateHome,
      }),
    ).rejects.toThrow();
  });
  it("resolves symlink aliases before checking state-path conflicts", async () => {
    const input = await fixture();
    await symlink(input.firstmateHome, join(root, "alias"));
    await expect(
      assertIsolatedStatePath(join(root, "alias/new-home"), [
        input.firstmateHome,
      ]),
    ).rejects.toThrow();
    await expect(
      assertIsolatedStatePath(input.amunStateDirectory, [input.firstmateHome]),
    ).resolves.toBeUndefined();
  });
});

it("finds an installed Pi through executable symlinks without running it", async () => {
  const { discoverPiInstallations } = await import("../src/existing-setup.js");
  const input = await fixture();
  await mkdir(join(input.piPackageDirectory, "dist/bundle"), {
    recursive: true,
  });
  const entry = join(input.piPackageDirectory, "dist/bundle/cli.js");
  await writeFile(
    entry,
    'throw new Error("must not execute during discovery")',
  );
  const alias = join(root, "pi");
  await symlink(entry, alias);
  const result = await discoverPiInstallations([
    alias,
    entry,
    join(root, "missing"),
  ]);
  expect(result).toEqual([
    {
      executable: alias,
      packageDirectory: input.piPackageDirectory,
      version: "1.4.0",
    },
  ]);
});
it("leaves a shell-wrapper installation unresolved instead of executing startup scripts", async () => {
  const { discoverPiInstallations } = await import("../src/existing-setup.js");
  await fixture();
  const wrapper = join(root, "pi-wrapper");
  await writeFile(wrapper, "#!/bin/sh\ntouch personal-files");
  expect(await discoverPiInstallations([wrapper])).toEqual([]);
});
it("does not follow a lock symlink into a credential file", async () => {
  const input = await fixture();
  await rm(join(input.firstmateHome, "state/.lock"));
  await symlink(
    join(input.piConfigDirectory, "auth.json"),
    join(input.firstmateHome, "state/.lock"),
  );
  const result = await inspectExistingSetup(input);
  expect(result.firstmateSession).toBe("unknown");
  expect(JSON.stringify(result)).not.toContain("PRIVATE-CANARY");
});

it("does not inspect a state directory redirected outside the Firstmate home", async () => {
  const input = await fixture();
  await rm(join(input.firstmateHome, "state"), { recursive: true });
  await writeFile(join(input.piConfigDirectory, ".lock"), `${process.pid}\n`);
  await symlink(input.piConfigDirectory, join(input.firstmateHome, "state"));
  expect((await inspectExistingSetup(input)).firstmateSession).toBe("unknown");
});
it("does not include malformed metadata contents in errors", async () => {
  const input = await fixture();
  await writeFile(
    join(input.piPackageDirectory, "package.json"),
    "PRIVATE-CANARY",
  );
  await expect(inspectExistingSetup(input)).rejects.toThrow(
    "Unreadable Pi package metadata",
  );
});
