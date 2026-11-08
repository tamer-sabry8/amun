import { createHash } from "node:crypto";
import { Redactor } from "../../security/src/redaction.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { userInfo } from "node:os";
import { join } from "node:path";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { readBoundedPrivateFile } from "./endpoint-receipt.ts";
import type { bearingsSnapshot } from "../../contracts/src/bearings.ts";

async function lavishBin() {
  const versions = join(userInfo().homedir, ".nvm/versions/node");
  const installed = (await readdir(versions).catch(() => []))
    .filter((v) => /^v\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  for (const dir of [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...installed.map((v) => join(versions, v, "bin")),
  ]) {
    if (
      await access(join(dir, "lavish-axi"), 1).then(
        () => true,
        () => false,
      )
    )
      return dir;
  }
  throw Error("Install Lavish to use the local board");
}
async function boardPort(directory: string) {
  const file = join(directory, "port");
  try {
    const text = await readBoundedPrivateFile(file, 8);
    if (!/^\d{4,5}$/.test(text) || +text < 1024 || +text > 65535)
      throw Error("Invalid board port");
    return +text;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const server = createServer();
  await new Promise<void>((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw Error("No board port");
    await writeFile(file, String(addr.port), { flag: "wx", mode: 0o600 });
    return addr.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export class BoardError extends Error {}
export function boardPayload(
  home: string,
  snapshot: ReturnType<typeof bearingsSnapshot.parse>,
  redactor: Redactor,
) {
  type Row = Record<string, unknown>;
  const text = (r: Row, key: string, fallback: string) =>
    typeof r[key] === "string" && r[key]
      ? redactor.text(r[key]).slice(0, 2048)
      : fallback;
  const repo = (r: Row) => text(r, "repo", "") || null;
  const slug = (id: string) => /^[a-zA-Z0-9_.-]{1,128}$/.test(id);
  const rowId = (id: string) =>
    slug(id)
      ? id
      : "notice-" + createHash("sha256").update(id).digest("hex").slice(0, 20);
  const underway = (r: Row) => {
    const id = text(r, "id", "crew");
    return {
      id,
      name: text(r, "name", id),
      state: text(r, "state", "recorded"),
      kind: text(r, "kind", "secondmate"),
      repo: repo(r),
      doing: text(r, "doing", text(r, "summary", "No activity recorded")),
    };
  };
  const charted = (r: Row, notice: boolean) => {
    const id = text(r, "id", text(r, "task", text(r, "title", "fleet"))),
      filed = text(r, "filed", "");
    return {
      id: rowId(id),
      repo: repo(r),
      title: text(r, "title", text(r, "summary", id)),
      reason: text(r, "reason", text(r, "review", "")),
      dispatchable: false,
      kind: notice || !slug(id) ? "warning" : "queued",
      ...(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(filed)
        ? { filed }
        : {}),
    };
  };
  return {
    schema: "fm-bearings-board.v1",
    home,
    generated: snapshot.generated,
    prs_live: snapshot.prs === "live",
    captains_call: snapshot.decisions_open
      .filter((r) => slug(text(r, "key", text(r, "id", ""))))
      .map((r) => ({
        key: text(r, "key", text(r, "id", "")),
        type: "decision",
        repo: repo(r),
        title: text(r, "summary", text(r, "id", "Decision")),
        decide: text(r, "question", "Captain's decision"),
        options: [],
        allow_freeform: true,
      })),
    underway: [...snapshot.secondmates, ...snapshot.in_flight].map(underway),
    landed: snapshot.landed.map((r) => ({
      id: text(r, "id", text(r, "task", "record")),
      repo: repo(r),
      what: text(r, "what", text(r, "title", "Completed")),
      owner: text(r, "owner", "(main)"),
    })),
    charted: [
      ...snapshot.gates.map((r) => charted(r, false)),
      ...[
        ...(snapshot.unhealthy_endpoints ?? []),
        ...snapshot.contributions.captain,
        ...(snapshot.candidate_prs ?? []),
      ].map((r) => charted(r, true)),
    ],
  };
}
export async function buildFirstmateBoard(
  home: string,
  env: Record<string, string>,
  snapshot: ReturnType<typeof bearingsSnapshot.parse>,
  redactor = new Redactor(),
) {
  const state = join(env.HOME!, "lavish");
  for (const dir of [state, join(home, ".lavish")]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await realpath(dir)) !== dir) throw Error("Unsafe board directory");
  }
  const port = await boardPort(state),
    bin = await lavishBin();
  const payload = boardPayload(home, snapshot, redactor);
  const temp = await mkdtemp(join(state, "build-"));
  try {
    const input = join(temp, "snapshot.json");
    await writeFile(input, JSON.stringify(payload), {
      mode: 0o600,
      flag: "wx",
    });
    const { stdout } = await promisify(execFile)(
      "/bin/bash",
      [join(home, "bin/fm-bearings-board.sh"), "build", input],
      {
        cwd: home,
        env: {
          ...env,
          PATH: bin + ":" + env.PATH,
          LAVISH_AXI_HOST: "127.0.0.1",
          LAVISH_AXI_LINK_HOST: "127.0.0.1",
          LAVISH_AXI_PORT: String(port),
          LAVISH_AXI_STATE_DIR: state,
          FM_PROCEVENT_LAUNCH_CONFIRM_SECONDS: "12",
          LAVISH_AXI_NO_OPEN: "1",
        },
        timeout: 60000,
        maxBuffer: 1048576,
      },
    );
    const url =
      /^\s*url:\s*"?(http:\/\/127\.0\.0\.1:\d+\/session\/([a-f0-9]{16}))"?\s*$/m.exec(
        stdout,
      );
    const lines = stdout.split("\n");
    const source = lines.find((line) => line.startsWith("bound: "))?.slice(7);
    if (!url)
      throw new BoardError("Lavish did not return a local session URL.");
    if (new URL(url[1]!).port !== String(port))
      throw new BoardError("Lavish returned a different port.");
    if (!source || !/^lavish-[a-f0-9]+$/.test(source))
      throw new BoardError("Firstmate did not bind the local board.");
    if (
      !lines.some(
        (line) =>
          line === "armed: " + source || line === "already-armed: " + source,
      )
    )
      throw new BoardError("Firstmate did not verify its board listener.");
    return url[1]!;
  } catch (e) {
    if (e instanceof BoardError) throw e;
    const stderr = String((e as { stderr?: string }).stderr ?? "");
    const reason = [
      "cannot bind",
      "cannot arm",
      "not listening",
      "not listed open",
      "is not live",
      "cannot establish",
      "invalid",
      "cannot derive",
    ].find((v) => stderr.includes(v));
    throw new BoardError(
      "The local board failed upstream verification" +
        (reason ? " (" + reason + ")" : "") +
        ".",
      { cause: e },
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
