import { sessionTree, type SessionEntryRef } from "./native-session-tree.ts";
import { lstat, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { NativePiResult } from "./native-pi.ts";
export interface NativeSessionRuntime {
  session: {
    isStreaming: boolean;
    sessionManager: {
      getLeafId(): string | null;
      getEntries(): SessionEntryRef[];
    };
    getUserMessagesForForking(): { entryId: string; text: string }[];
    navigateTree(
      id: string,
      options: { summarize: boolean },
    ): Promise<{ cancelled: boolean }>;
  };
  newSession(): Promise<{ cancelled: boolean }>;
  switchSession(
    path: string,
    options: { cwdOverride: string },
  ): Promise<{ cancelled: boolean }>;
  fork(
    id: string,
    options?: { position: "at" },
  ): Promise<{ cancelled: boolean }>;
}
export class NativePiSessions {
  constructor(
    private readonly runtime: NativeSessionRuntime,
    private readonly cwd: string,
    private readonly directory: string,
    private readonly list: () => Promise<
      { id: string; name?: string; path: string; cwd: string }[]
    >,
  ) {}
  private async owned(path: string, cwd: string) {
    const absolute = resolve(path),
      part = relative(this.directory, absolute);
    if (
      cwd !== this.cwd ||
      !part ||
      part.startsWith("..") ||
      isAbsolute(part) ||
      (await realpath(absolute)) !== absolute
    )
      throw Error("Session outside owned workspace");
    const stat = await lstat(absolute);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw Error("Unsafe session file");
    return absolute;
  }
  async run(command: string, argument: string): Promise<NativePiResult> {
    if (this.runtime.session.isStreaming)
      throw Error("Wait for the current turn before changing sessions");
    if (argument.length > 256 || argument.includes("\0"))
      throw Error("Invalid session selection");
    let result: { cancelled: boolean };
    if (command === "new") result = await this.runtime.newSession();
    else if (command === "resume") {
      const sessions = await this.list();
      if (sessions.length > 2048) throw Error("Session list too large");
      if (!argument) {
        const choices = [];
        for (const session of sessions) {
          await this.owned(session.path, session.cwd);
          if (session.id.length > 128 || (session.name?.length ?? 0) > 256)
            throw Error("Invalid session metadata");
          choices.push({ id: session.id, label: session.name || session.id });
        }
        return { kind: "choices", title: "Resume session", choices };
      }
      const selected = sessions.find((session) => session.id === argument);
      if (!selected) throw Error("Unknown owned session");
      result = await this.runtime.switchSession(
        await this.owned(selected.path, selected.cwd),
        { cwdOverride: this.cwd },
      );
    } else if (command === "clone") {
      const id = this.runtime.session.sessionManager.getLeafId();
      if (!id) throw Error("No current entry to clone");
      result = await this.runtime.fork(id, { position: "at" });
    } else if (command === "fork") {
      const entries = this.runtime.session.getUserMessagesForForking();
      if (entries.length > 2048) throw Error("Too many fork entries");
      if (!argument)
        return {
          kind: "choices",
          title: "Fork from user message",
          choices: entries.map((entry, index) => ({
            id: entry.entryId,
            label: `User message ${index + 1}`,
          })),
        };
      if (!entries.some((entry) => entry.entryId === argument))
        throw Error("Unknown fork entry");
      result = await this.runtime.fork(argument);
    } else if (command === "tree") {
      const entries = this.runtime.session.sessionManager.getEntries();
      const rows = sessionTree(
        entries,
        this.runtime.session.sessionManager.getLeafId(),
      );
      if (!argument) return { kind: "session-tree", rows };
      if (!rows.some((row) => row.id === argument))
        throw Error("Unknown tree entry");
      result = await this.runtime.session.navigateTree(argument, {
        summarize: false,
      });
    } else throw Error("Unsupported session operation");
    return {
      kind: "message",
      text: result.cancelled
        ? "Session change cancelled"
        : "Session change completed",
    };
  }
}
