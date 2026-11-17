import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  chmod,
  mkdir,
  symlink,
  readlink,
  lstat,
  realpath,
  writeFile,
  rm,
  rename,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dispatchRequest, dispatchScope } from "../../contracts/src/crew.ts";
import { FirstmateReleases } from "./firstmate-release.ts";
import { ownedWorktreeBranch } from "./firstmate-worktree.ts";
import { prepareWorkerProfile } from "./worker-profile.ts";
import { workerEnvironment } from "./worker-environment.ts";
import { createTmuxScope } from "./tmux-scope.ts";
import {
  loadEndpointReceipt,
  readBoundedPrivateFile,
  saveEndpointReceipt,
} from "./endpoint-receipt.ts";
import { parseFirstmateRecord, queryTmuxEndpoint } from "./tmux-observer.ts";
import { endpointPresence, observeOwnedTmux } from "./observe-owned-tmux.ts";
import {
  allowedProviders,
  copilotModelSelector,
  copilotProvider,
} from "./copilot-routing.ts";
import { writePiLauncher, type PiLauncherSource } from "./pi-launcher.ts";

const run = promisify(execFile);
async function privateDir(path: string) {
  await mkdir(path, { mode: 0o700, recursive: true });
  let stat = await lstat(path);
  if (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === process.getuid?.() &&
    (stat.mode & 0o077) !== 0 &&
    (await realpath(path)) === path
  ) {
    await chmod(path, 0o700);
    stat = await lstat(path);
  }
  if (
    (await realpath(path)) !== path ||
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw Error("Unsafe crew directory");
}
/** Sets a dead worker's identity aside under distinct names; nothing is replaced or deleted. */
export async function retireEndpoint(
  owner: string,
  id: string,
  files: Record<string, string>,
): Promise<string> {
  const parent = join(owner, "retired");
  await privateDir(parent);
  for (let attempt = 0; ; attempt++) {
    const dir = join(parent, `${id}-${Date.now()}-${attempt}`);
    try {
      await mkdir(dir, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST" && attempt < 50)
        continue;
      throw e;
    }
    await privateDir(dir);
    for (const [name, from] of Object.entries(files))
      await rename(from, join(dir, name)).catch((e) => {
        if (!unavailable(e)) throw e;
      });
    return dir;
  }
}
async function privateSetting(path: string, value: string) {
  try {
    await writeFile(path, value, { mode: 0o600, flag: "wx", flush: true });
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code !== "EEXIST" ||
      (await readBoundedPrivateFile(path, 65536)) !== value
    )
      throw Error("Existing crew setting differs");
  }
}
const unavailable = (e: unknown) =>
  (e as NodeJS.ErrnoException).code === "ENOENT";

type TmuxCommand = (args: string[], env?: NodeJS.ProcessEnv) => Promise<string>;
export async function crewScope(owner: string) {
  const binding = join(owner, "tmux.json");
  let server;
  try {
    server = dispatchScope.parse(
      JSON.parse(await readBoundedPrivateFile(binding, 1024)),
    );
  } catch (e) {
    if (!unavailable(e)) throw e;
    server = {
      scope: await createTmuxScope(),
      token: randomBytes(16).toString("hex"),
    };
    await privateSetting(binding, JSON.stringify(server));
  }
  await privateDir(server.scope);
  return server;
}
async function crewServer(owner: string, path: string, tmux: TmuxCommand) {
  const server = await crewScope(owner);
  const socket = join(server.scope, "tmux-" + process.getuid!(), "default");
  await privateDir(dirname(socket));
  const config = join(owner, "crew-tmux.conf");
  await privateSetting(
    config,
    [
      "set-option -g @amun-owner " + server.token,
      "set-option -g default-shell /bin/bash",
      'set-option -g default-command "/bin/bash --noprofile --norc"',
      "",
    ].join("\n"),
  );
  try {
    await lstat(socket);
  } catch (e) {
    if (!unavailable(e)) throw e;
    // Loss of an established server never authorizes a replacement dispatch.
    for (const harness of ["codex", "claude", "pi"]) {
      try {
        await lstat(join(owner, "amun-" + harness + ".launch"));
      } catch (err) {
        if (unavailable(err)) continue;
        throw err;
      }
      throw Error("Previously launched crew endpoint unavailable");
    }
    await tmux(
      [
        "-f",
        config,
        "-S",
        socket,
        "new-session",
        "-d",
        "-s",
        "firstmate",
        "/bin/cat",
      ],
      {
        HOME: owner,
        PATH: path,
        SHELL: "/bin/bash",
        TMUX_TMPDIR: server.scope,
      },
    );
  }
  const info = await lstat(socket);
  if (
    !info.isSocket() ||
    info.uid !== process.getuid?.() ||
    (await realpath(socket)) !== socket ||
    (await tmux(["-S", socket, "show-options", "-gqv", "@amun-owner"])) !==
      server.token
  )
    throw Error("Crew server owner unavailable");
  return { ...server, socket };
}
async function captureEndpoint(
  {
    id,
    harness,
    home,
    worker,
    receipts,
    socket,
    scope,
    token,
  }: {
    id: string;
    harness: "codex" | "claude" | "pi";
    home: string;
    worker: string;
    receipts: string;
    socket: string;
    scope: string;
    token: string;
  },
  tmux: TmuxCommand,
) {
  const record = parseFirstmateRecord(
    await readBoundedPrivateFile(join(home, "state", id + ".meta"), 65536),
  );
  if (
    record.taskId !== id ||
    record.harness !== harness ||
    record.worktree !== worker
  )
    throw Error("Unexpected dispatch record");
  const pane = await tmux([
    "-S",
    socket,
    "display-message",
    "-p",
    "-t",
    record.window,
    "#{pane_id}",
  ]);
  const live = await queryTmuxEndpoint(socket, pane, tmux);
  if (
    !live ||
    live.dead ||
    live.ownerToken !== token ||
    live.worktree !== worker
  )
    throw Error("Unverified worker endpoint");
  const { paneId, windowId, serverPid, panePid, ownerToken, worktree } = live;
  await saveEndpointReceipt(receipts, {
    version: 1,
    backend: "tmux",
    home,
    scope,
    socket,
    identity: {
      paneId,
      windowId,
      serverPid,
      panePid,
      ownerToken,
      worktree,
      taskId: id,
      window: record.window,
      spawnGeneration: record.spawnGeneration,
    },
  });
}

export async function dispatchFirstmate(
  releases: FirstmateReleases,
  receipts: string,
  binary: string,
  input: unknown,
  pi?: PiLauncherSource,
) {
  const { harness, charter } = dispatchRequest.parse(input);
  const { home, revision } = await releases.crewHome();
  const worker = join(dirname(home), harness + "-worker");
  const owner = dirname(dirname(home)),
    id = "amun-" + harness;
  await ownedWorktreeBranch(home, worker);
  await privateDir(receipts);
  let respawn = false;
  try {
    const existing = await loadEndpointReceipt(receipts, id);
    if (existing.home !== home || existing.identity.worktree !== worker)
      throw Error("Receipt belongs to a different crew");
    const status = await observeOwnedTmux(receipts, id, binary);
    if (status.endpoint === "verified")
      return "Firstmate already has this " + harness + " worker.";
    // Only a worker proven gone (its own tmux server stopped, or no longer
    // holding that pane) is started again, through Firstmate's own respawn.
    // Anything unclear is left alone: it may still be alive.
    if ((await endpointPresence(receipts, id, binary)) !== "gone")
      return "The saved worker endpoint is unavailable. Its launch was not repeated.";
    respawn = true;
  } catch (e) {
    if (!unavailable(e)) throw e;
  }
  const base = join(homedir(), "Library/Application Support/Amun/workers");
  const profile = await prepareWorkerProfile(base, harness);
  const node = await access("/opt/homebrew/bin/node", constants.X_OK).then(
    () => "/opt/homebrew/bin/node",
    () => "/usr/local/bin/node",
  );
  const binDir = join(owner, "launchers");
  await privateDir(binDir);
  let launcher: string;
  let piModel = copilotModelSelector;
  if (harness === "pi") {
    const source = pi ?? {
      binary: process.env.AMUN_PI_BINARY ?? "",
      entry: process.env.AMUN_PI_ENTRY ?? "",
      authRoot: process.env.AMUN_AUTH_ROOT ?? "",
    };
    let provider = source.provider;
    try {
      const saved = JSON.parse(
        await readBoundedPrivateFile(
          join(source.authRoot, "settings.json"),
          65536,
        ),
      ) as { defaultProvider?: unknown; defaultModel?: unknown };
      if (
        typeof saved.defaultProvider === "string" &&
        allowedProviders().includes(saved.defaultProvider) &&
        typeof saved.defaultModel === "string" &&
        /^[\w./:-]{1,128}$/.test(saved.defaultModel)
      ) {
        provider ??= saved.defaultProvider;
        piModel = `${saved.defaultProvider}/${saved.defaultModel}`;
      }
    } catch {
      // Fall back to default provider/model when settings.json is absent.
    }
    // Pi runs from Amun's bundled runtime and credentials, never a personal install.
    launcher = await writePiLauncher(binDir, {
      ...source,
      ...(provider ? { provider } : { provider: copilotProvider }),
    });
    await Promise.all([
      access(source.binary, constants.X_OK),
      access(source.entry),
    ]);
  } else {
    launcher = join(homedir(), ".local/bin", harness);
    const link = join(binDir, harness);
    try {
      await symlink(launcher, link);
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code !== "EEXIST" ||
        (await readlink(link)) !== launcher
      )
        throw Error("Unexpected crew launcher");
    }
  }
  await Promise.all([
    access(node, constants.X_OK),
    access(binary, constants.X_OK),
    access(launcher, constants.X_OK),
  ]);
  const env = workerEnvironment(harness, homedir(), profile, node);
  const path = binDir + ":" + dirname(node) + ":/usr/bin:/bin";
  const tmux = (
    args: string[],
    environment: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" },
  ) =>
    run(binary, args, {
      cwd: home,
      env: environment,
      timeout: 8000,
      maxBuffer: 65536,
    }).then((r) => r.stdout.trim());
  const { socket, scope, token } = await crewServer(owner, path, tmux);
  const marker = join(owner, id + ".launch");
  const witnessed = join(owner, "endpoint-observations");
  await privateDir(witnessed);
  let fresh = false;
  if (respawn) {
    await retireEndpoint(owner, id, {
      "receipt.json": join(receipts, id + ".json"),
      "witness.json": join(witnessed, id + ".json"),
      "launch.json": marker,
    });
  }
  try {
    const intent = JSON.parse(await readBoundedPrivateFile(marker, 1024));
    if (
      intent.id !== id ||
      intent.harness !== harness ||
      intent.revision !== revision
    )
      throw Error("Dispatch intent mismatch");
  } catch (e) {
    if (!unavailable(e)) throw e;
    fresh = true;
    await releases.verifyHomes(revision, [home, worker]);
    for (const dir of ["config", "state", "data", "projects"])
      await privateDir(join(home, dir));
    for (const [key, val] of Object.entries({
      backend: "tmux",
      "codex-permission-mode": "restricted",
      "claude-permission-mode": "auto",
      "launch-env-allowlist": "CODEX_HOME\nCLAUDE_CONFIG_DIR\nUSER\nLOGNAME",
      ...(harness === "pi"
        ? {
            "crew-harness": "pi",
            "secondmate-harness": "pi " + piModel,
            "supervision-branch-model": piModel,
          }
        : {}),
    }))
      await privateSetting(join(home, "config", key), val + "\n");
    const launchEnv = {
      ...env,
      PATH: path,
      FM_HOME: home,
      FM_ROOT_OVERRIDE: home,
      TMUX_TMPDIR: scope,
      FM_BACKEND: "tmux",
      TERM: "xterm-256color",
      FM_SECONDMATE_CHARTER: charter,
      FM_SECONDMATE_SCOPE: "Amun workspace only",
    };
    const invoke = (script: string, args: string[]) =>
      run(
        "/bin/bash",
        [
          "-c",
          'umask 077; exec /bin/bash "$@"',
          "amun",
          join(home, "bin", script),
          ...args,
        ],
        { cwd: home, env: launchEnv, timeout: 45000, maxBuffer: 65536 },
      );
    await writeFile(marker, JSON.stringify({ id, revision, harness }), {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    try {
      for (const key of [
        "HOME",
        "USER",
        "LOGNAME",
        "CODEX_HOME",
        "CLAUDE_CONFIG_DIR",
        "TMPDIR",
      ]) {
        const val = env[key];
        await tmux([
          "-S",
          socket,
          "set-environment",
          "-g",
          ...(val ? [key, val] : ["-u", key]),
        ]);
      }
      // A task Firstmate already has is brought back by its own respawn.
      if (!respawn)
        try {
          await invoke("fm-home-seed.sh", [id, worker, "--no-projects"]);
        } catch {
          await rm(marker);
          throw Error("Firstmate could not seed this worker");
        }
      // Commit the launch intent before invoking spawn. Recovery only republishes a witnessed identity.
      try {
        await invoke(
          "fm-spawn.sh",
          respawn
            ? [id, "--secondmate", "--backend", "tmux"]
            : [
                id,
                worker,
                "--harness",
                harness,
                ...(harness === "pi" ? ["--model", piModel] : []),
                "--backend",
                "tmux",
                "--secondmate",
              ],
        );
      } catch {
        /* An upstream process may have launched despite a lost reply. */
      }
    } finally {
      // Future windows start with the crew's private HOME, independent of either subscription.
      await tmux(["-S", socket, "set-environment", "-g", "HOME", owner]);
      for (const key of ["CODEX_HOME", "CLAUDE_CONFIG_DIR"])
        await tmux(["-S", socket, "set-environment", "-gu", key]);
    }
  }
  try {
    if (fresh)
      await captureEndpoint(
        {
          id,
          harness,
          home,
          worker,
          receipts: witnessed,
          socket,
          scope,
          token,
        },
        tmux,
      );
    const observation = await loadEndpointReceipt(witnessed, id);
    if (
      observation.home !== home ||
      observation.identity.worktree !== worker ||
      (await observeOwnedTmux(witnessed, id, binary)).endpoint !== "verified"
    )
      throw Error("Original endpoint unavailable");
    await saveEndpointReceipt(receipts, observation);
    return respawn
      ? "Firstmate started the " + harness + " worker again."
      : fresh
        ? "Firstmate dispatched " + harness + " and saved its endpoint."
        : "Firstmate recovered the original " + harness + " endpoint.";
  } catch {
    return "Firstmate launch outcome is unknown. Check this crew again to recover its endpoint.";
  }
}
