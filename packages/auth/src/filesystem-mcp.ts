import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { lstat, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const folderResult = z.object({ content: z.string().max(65536) });

export async function listSelectedFolder(modules: string, folder: string) {
  if (
    resolve(folder) !== folder ||
    (await realpath(folder)) !== folder ||
    Array.from(folder).some((char) => char.charCodeAt(0) < 32) ||
    folder === "/" ||
    folder === homedir() ||
    folder === "/Volumes" ||
    dirname(folder) === "/Volumes"
  )
    throw Error("Select a folder within a volume");
  const info = await lstat(folder);
  if (!info.isDirectory() || info.dev !== (await stat(dirname(folder))).dev)
    throw Error("Select a folder within a volume");
  const home = await mkdtemp(join(tmpdir(), "amun-folder-server-"));
  const client = new Client({ name: "amun", version: "0.1.0" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          join(
            modules,
            "@modelcontextprotocol/server-filesystem/dist/index.js",
          ),
          "--read-only",
          "--confine-roots",
          "--",
          folder,
        ],
        env: { ELECTRON_RUN_AS_NODE: "1", HOME: home, PATH: "/usr/bin:/bin" },
        cwd: home,
        stderr: "ignore",
        maxBufferSize: 1048576,
      }),
      { timeout: 10000 },
    );
    const allowed = await client.callTool(
      { name: "list_allowed_directories", arguments: {} },
      undefined,
      { timeout: 5000 },
    );
    if (
      allowed.isError ||
      folderResult.parse(allowed.structuredContent).content !==
        "Allowed directories:\n" + folder
    )
      throw Error("Folder scope unavailable");
    const read = await client.callTool(
      { name: "list_directory", arguments: { path: folder } },
      undefined,
      { timeout: 10000 },
    );
    if (read.isError) throw Error("Folder listing unavailable");
    return (
      folderResult.parse(read.structuredContent).content ||
      "This folder is empty."
    );
  } finally {
    try {
      await client.close();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
}
