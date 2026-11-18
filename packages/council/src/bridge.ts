// File bridge between the Chair's owner-question tool and Amun. The tool
// process writes a question file and waits for an answer file; Amun's service
// shows the question on the Island and writes the answer. Files keep the two
// processes decoupled and survive an app restart mid-council.
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  chairQuestions,
  type ChairQuestion,
} from "../../domain/src/work/council.ts";

export interface PendingQuestion {
  id: string;
  askedAt: string;
  questions: ChairQuestion[];
}
const safe = (id: string) => /^[a-zA-Z0-9-]{1,64}$/.test(id);
const questionFile = (dir: string, id: string) =>
  join(dir, `question-${id}.json`);
const answerFile = (dir: string, id: string) => join(dir, `answer-${id}.json`);

async function writeAtomic(path: string, value: unknown) {
  const temp = path + ".tmp";
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

export async function ask(
  dir: string,
  id: string,
  input: unknown,
  now = new Date(),
) {
  if (!safe(id)) throw Error("Invalid question id");
  const questions = chairQuestions(input);
  if (!questions.length) throw Error("No question to ask");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeAtomic(questionFile(dir, id), {
    id,
    askedAt: now.toISOString(),
    questions,
  } satisfies PendingQuestion);
  return questions;
}

/** Questions the Chair is waiting on. Malformed files are ignored, not trusted. */
export async function pending(dir: string): Promise<PendingQuestion[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const answered = new Set(
    names
      .filter((name) => name.startsWith("answer-"))
      .map((name) => name.slice(7, -5)),
  );
  const result: PendingQuestion[] = [];
  for (const name of names.sort()) {
    const match = /^question-([a-zA-Z0-9-]{1,64})\.json$/.exec(name);
    if (!match || answered.has(match[1]!)) continue;
    try {
      const raw = JSON.parse(await readFile(join(dir, name), "utf8"));
      const questions = chairQuestions(raw);
      if (raw.id === match[1] && questions.length)
        result.push({
          id: raw.id,
          askedAt: String(raw.askedAt ?? ""),
          questions,
        });
    } catch {
      /* A half-written or foreign file is not a question. */
    }
  }
  return result;
}

export async function answer(dir: string, id: string, answers: string[]) {
  if (!safe(id)) throw Error("Invalid question id");
  await writeAtomic(answerFile(dir, id), { id, answers });
}

/** Resolves with the owner's answers. Nothing is assumed while it waits. */
export async function waitForAnswer(
  dir: string,
  id: string,
  options: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  for (;;) {
    if (options.signal?.aborted) throw Error("Question withdrawn");
    try {
      const raw = JSON.parse(await readFile(answerFile(dir, id), "utf8"));
      if (raw.id === id && Array.isArray(raw.answers)) {
        await rm(questionFile(dir, id), { force: true });
        await rm(answerFile(dir, id), { force: true });
        return raw.answers.map(String);
      }
    } catch {
      /* Not answered yet. */
    }
    await new Promise((resolve) =>
      setTimeout(resolve, options.intervalMs ?? 400),
    );
  }
}
