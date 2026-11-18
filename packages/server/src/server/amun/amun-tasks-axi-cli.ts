import { execFile } from "node:child_process";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { resolveFirstmateRoot } from "./amun-paths.js";
import { firstmateEnv, readFleetSnapshot, type FirstmateHome } from "./firstmate-cli.js";
import { PmStore, type Initiative } from "./pm-store.js";

const run = promisify(execFile);

export const USAGE = `usage: amun-tasks-axi <command> [args] [flags]
Amun's PM layer over Firstmate's tasks-axi backlog. Backlog changes always go
through the real tasks-axi (via vendor/firstmate/bin/fm-tasks-axi.sh); Amun-only
fields (initiatives, 4-Question answers, sprints, board) live in
$FM_HOME/data/amun-pm.db.
commands:
  sync                                   mirror data/backlog.md onto the board
  board                                  print the six-column board as JSON
  add <id> "<title>" [--kind k] [--initiative id] [--body text]
                                         file a backlog item, then sync
  initiative <id> --title t [--what s] [--why s] [--when s] [--cost s] [--status s]
                                         set an initiative and its 4-Question answers
  initiatives                            list initiatives with unanswered questions
flags:
  --home <dir>   Product Space home (default: $FM_HOME)
  --help`;

export interface CliIo {
  out: (text: string) => void;
  env: NodeJS.ProcessEnv;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function withMissing(initiative: Initiative) {
  return { ...initiative, missing: PmStore.missingQuestions(initiative) };
}

async function sync(home: FirstmateHome, store: PmStore) {
  const snapshot = await readFleetSnapshot(home);
  return store.projectBacklog(snapshot.backlog.records);
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      home: { type: "string" },
      kind: { type: "string" },
      initiative: { type: "string" },
      body: { type: "string" },
      title: { type: "string" },
      what: { type: "string" },
      why: { type: "string" },
      when: { type: "string" },
      cost: { type: "string" },
      status: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    io.out(USAGE);
    return command || values.help ? 0 : 2;
  }
  const fmHome = values.home ?? io.env.FM_HOME;
  if (!fmHome) throw new UsageError("FM_HOME is not set; pass --home <dir>");
  const home: FirstmateHome = { root: resolveFirstmateRoot(io.env), fmHome: path.resolve(fmHome) };
  const store = PmStore.forHome(home.fmHome);
  const print = (value: unknown) => io.out(JSON.stringify(value, null, 2));
  try {
    switch (command) {
      case "sync":
        print(await sync(home, store));
        return 0;
      case "board":
        print(store.board());
        return 0;
      case "add": {
        const [id, title] = rest;
        if (!id || !title) throw new UsageError('add needs <id> "<title>"');
        const args = ["add", id, title, ...(values.kind ? ["--kind", values.kind] : [])];
        if (values.body) args.push("--body", values.body);
        await run(path.join(home.root, "bin", "fm-tasks-axi.sh"), args, {
          cwd: home.root,
          env: firstmateEnv(home, io.env),
        });
        const projection = await sync(home, store);
        if (values.initiative) {
          const story = store.storyForBacklogTask(id);
          if (story) store.upsertStory({ ...story, initiativeId: values.initiative });
        }
        print({ added: id, ...projection });
        return 0;
      }
      case "initiative": {
        const [id] = rest;
        if (!id || !values.title) throw new UsageError("initiative needs <id> --title <title>");
        print(
          withMissing(
            store.upsertInitiative({
              id,
              title: values.title,
              ...(values.what ? { what: values.what } : {}),
              ...(values.why ? { why: values.why } : {}),
              ...(values.when ? { when: values.when } : {}),
              ...(values.cost ? { cost: values.cost } : {}),
              ...(values.status ? { status: values.status as Initiative["status"] } : {}),
            }),
          ),
        );
        return 0;
      }
      case "initiatives":
        print(store.listInitiatives().map(withMissing));
        return 0;
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
  } finally {
    store.close();
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    process.exitCode = await runCli(argv, { out: (t) => process.stdout.write(`${t}\n`), env: process.env });
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
