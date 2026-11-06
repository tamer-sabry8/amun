import { it, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativePiSessions } from "../src/native-pi-sessions.ts";
it("selects only owned session IDs and uses the SDK lifecycle for new/resume/fork/clone", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-sessions-")));
  const dir = join(root, "sessions");
  await mkdir(dir, { mode: 0o700 });
  const file = join(dir, "a.jsonl");
  await writeFile(file, "test", { mode: 0o600 });
  const runtime = {
    session: {
      isStreaming: false,
      sessionManager: {
        getLeafId: () => "leaf",
        getEntries: () => [{ id: "leaf", type: "message" }],
      },
      getUserMessagesForForking: () => [
        { entryId: "user", text: "private prompt" },
      ],
      navigateTree: vi.fn(async () => ({ cancelled: false })),
    },
    newSession: vi.fn(async () => ({ cancelled: false })),
    switchSession: vi.fn(async () => ({ cancelled: false })),
    fork: vi.fn(async () => ({ cancelled: false })),
  };
  const actions = new NativePiSessions(runtime, root, dir, async () => [
    { id: "owned", name: "Session", path: file, cwd: root },
  ]);
  try {
    expect(await actions.run("resume", "")).toEqual({
      kind: "choices",
      title: "Resume session",
      choices: [{ id: "owned", label: "Session" }],
    });
    await actions.run("resume", "owned");
    expect(runtime.switchSession).toHaveBeenCalledWith(file, {
      cwdOverride: root,
    });
    await expect(actions.run("resume", file)).rejects.toThrow();
    await actions.run("new", "");
    expect(runtime.newSession).toHaveBeenCalled();
    await actions.run("clone", "");
    expect(runtime.fork).toHaveBeenCalledWith("leaf", { position: "at" });
    await actions.run("fork", "user");
    expect(runtime.fork).toHaveBeenCalledWith("user");
    expect(JSON.stringify(await actions.run("fork", ""))).not.toContain(
      "private prompt",
    );
    await actions.run("tree", "leaf");
    expect(runtime.session.navigateTree).toHaveBeenCalledWith("leaf", {
      summarize: false,
    });
    await expect(actions.run("tree", "unknown")).rejects.toThrow();
    runtime.session.isStreaming = true;
    await expect(actions.run("new", "")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("refuses escaped, linked and foreign-cwd sessions before switching", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-sessions-")));
  const dir = join(root, "sessions");
  await mkdir(dir);
  const outside = join(root, "outside");
  await writeFile(outside, "test");
  const linked = join(dir, "linked");
  await symlink(outside, linked);
  const runtime = {
    session: {
      isStreaming: false,
      sessionManager: { getLeafId: () => null, getEntries: () => [] },
      getUserMessagesForForking: () => [],
      navigateTree: vi.fn(),
    },
    newSession: vi.fn(),
    switchSession: vi.fn(),
    fork: vi.fn(),
  };
  try {
    for (const [path, cwd] of [
      [outside, root],
      [linked, root],
      [linked, "/foreign"],
    ]) {
      const actions = new NativePiSessions(runtime, root, dir, async () => [
        { id: "bad", path: path!, cwd: cwd! },
      ]);
      await expect(actions.run("resume", "bad")).rejects.toThrow();
    }
    expect(runtime.switchSession).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
