import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import {
  lstat,
  mkdir,
  realpath,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { bearingsSnapshot } from "../../contracts/src/bearings.ts";
import { FirstmateReleases } from "./firstmate-release.ts";
import { Redactor } from "../../security/src/redaction.ts";
import { dispatchScope } from "../../contracts/src/crew.ts";
import { readBoundedPrivateFile } from "./endpoint-receipt.ts";

function describe(row: Record<string, unknown>) {
  const fields = [
    "id",
    "owner",
    "repo",
    "name",
    "what",
    "title",
    "question",
    "doing",
    "reason",
    "summary",
    "state",
    "artifact",
    "num",
    "task",
    "review",
    "checks",
    "mergeable",
  ];
  const values = fields
    .map((k) => row[k])
    .filter((v): v is string => typeof v === "string" && !!v && v !== "-");
  return (
    [...new Set(values)].join(" · ").slice(0, 600) ||
    "Recorded item (details unavailable)"
  );
}
export async function firstmateBearings(
  releases: FirstmateReleases,
  argument: string,
) {
  const match = /^(?:(file)(?: |$))?(include PRs)?$/i.exec(argument.trim());
  if (!match)
    return "Supported options are /bearings, /bearings file and include PRs.";
  const { home, revision } = await releases.crewHome();
  await releases.verifyHomes(revision, [home]);
  const owner = dirname(dirname(home));
  let scope = owner;
  try {
    const saved = dispatchScope.parse(
      JSON.parse(await readBoundedPrivateFile(join(owner, "tmux.json"), 1024)),
    );
    const socket = join(saved.scope, "tmux-" + process.getuid!(), "default");
    if (
      (await realpath(socket)) !== socket ||
      !(await lstat(socket)).isSocket()
    )
      throw Error("Invalid crew socket");
    const { stdout } = await promisify(execFile)(
      "/opt/homebrew/bin/tmux",
      ["-N", "-S", socket, "show-options", "-gqv", "@amun-owner"],
      { timeout: 3000, env: { PATH: "/usr/bin:/bin" } },
    );
    if (stdout.trim() !== saved.token) throw Error("Invalid crew identity");
    scope = saved.scope;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  for (const name of ["data", "config", "projects", "state"]) {
    const dir = join(home, name);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await realpath(dir)) !== dir || !(await lstat(dir)).isDirectory())
      throw Error("Unsafe crew state");
  }
  const { stdout } = await promisify(execFile)(
    "/bin/bash",
    [
      join(home, "bin/fm-bearings-snapshot.sh"),
      "--json",
      ...(match[2] ? ["--include-prs"] : []),
    ],
    {
      cwd: home,
      env: {
        HOME: owner,
        PATH: "/usr/bin:/bin:/opt/homebrew/bin",
        FM_HOME: home,
        FM_ROOT_OVERRIDE: home,
        FM_BACKEND: "tmux",
        TMUX_TMPDIR: scope,
      },
      timeout: 60000,
      maxBuffer: 1048576,
    },
  );
  const s = bearingsSnapshot.parse(JSON.parse(stdout)),
    c = s.contributions;
  const section = (
    name: string,
    items: Record<string, unknown>[],
    empty: string,
  ) => name + "\n" + (items.length ? items.map(describe).join("\n") : empty);
  const digest = new Redactor()
    .text(
      [
        section(
          "Captain’s Call",
          [...s.decisions_open, ...c.captain],
          c.proven_clear
            ? "Nothing needs your action right now."
            : "No decision is recorded.",
        ),
        "Contributions checked: " + c.checked + "/" + c.known + ".",
        section(
          "Recently Landed",
          s.landed,
          "No recent completions are in the current baseline.",
        ),
        section(
          "Underway",
          [...s.secondmates, ...s.in_flight],
          "Nothing is underway.",
        ),
        section(
          "Charted Next",
          [...s.gates, ...(s.unhealthy_endpoints ?? [])],
          "Nothing is queued.",
        ),
        ...(match[2]
          ? ["PR discovery: " + s.prs, ...(s.candidate_prs ?? []).map(describe)]
          : []),
      ].join("\n\n"),
    )
    .slice(0, 240000);
  if (!match[1]) return digest;
  const filename = "status-report-" + s.generated.slice(0, 10) + ".md";
  const target = join(home, "data", filename),
    temp = target + "-" + randomUUID();
  try {
    await writeFile(temp, digest + "\n", {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  return digest + "\n\nSaved to data/" + filename;
}
