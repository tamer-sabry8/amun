import { lstat, mkdir, open, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { commandCatalog } from "../../domain/src/pi-commands.ts";
import { constants } from "node:fs";

export async function resourceDirectories(root: string) {
  const dirs = { prompts: join(root, "prompts"), skills: join(root, "skills") };
  let count = 0,
    bytes = 0;
  async function check(path: string, depth: number) {
    const info = await lstat(path);
    if (
      ++count > 512 ||
      depth > 8 ||
      info.uid !== process.getuid?.() ||
      info.isSymbolicLink() ||
      (info.mode & 0o022) !== 0 ||
      (await realpath(path)) !== path
    )
      throw Error("Unsafe Pi resource");
    if (info.isDirectory()) {
      for await (const entry of await opendir(path))
        await check(join(path, entry.name), depth + 1);
    } else {
      bytes += info.size;
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size > 65536 ||
        bytes > 2097152
      )
        throw Error("Unsupported Pi resource");
    }
  }
  for (const path of Object.values(dirs)) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await check(path, 0);
  }
  return dirs;
}
export interface ResourceSession {
  sessionId: string;
  promptTemplates: readonly {
    name: string;
    content: string;
    filePath: string;
  }[];
  resourceLoader: {
    getSkills(): {
      skills: readonly { name: string; filePath: string; baseDir: string }[];
    };
  };
}
export function resourceNames(s: ResourceSession) {
  const resources = [
    ...s.promptTemplates.map((t) => ({ name: t.name, source: "prompt" })),
    ...s.resourceLoader
      .getSkills()
      .skills.map((t) => ({ name: "skill:" + t.name, source: "skill" })),
  ];
  return commandCatalog(resources)
    .filter(
      (c) =>
        c.source !== "builtin" &&
        !["updatefirstmate", "skill:updatefirstmate"].includes(c.name),
    )
    .map((c) => c.name);
}
export async function expandResource(
  s: ResourceSession,
  root: string,
  name: string,
  argument: string,
  expandTemplate: (
    text: string,
    templates: ResourceSession["promptTemplates"],
  ) => string,
  stripFrontmatter: (text: string) => string,
) {
  if (!resourceNames(s).includes(name)) throw Error("Resource unavailable");
  let draft: string;
  if (name.startsWith("skill:")) {
    const skill = s.resourceLoader
      .getSkills()
      .skills.find((t) => "skill:" + t.name === name);
    if (
      !skill ||
      !skill.filePath.startsWith(join(root, "skills") + "/") ||
      (await realpath(skill.filePath)) !== skill.filePath
    )
      throw Error("Unexpected skill path");
    const file = await open(
      skill.filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let body: string;
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o022) !== 0 ||
        stat.size > 65536
      )
        throw Error("Unsafe Pi skill");
      const buffer = Buffer.alloc(65537);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== stat.size) throw Error("Pi skill changed during read");
      body = stripFrontmatter(buffer.toString("utf8", 0, bytesRead)).trim();
    } finally {
      await file.close();
    }
    draft =
      `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>` +
      (argument ? "\n\n" + argument : "");
  } else {
    draft = expandTemplate(
      "/" + name + (argument ? " " + argument : ""),
      s.promptTemplates,
    );
  }
  if (!draft.trim() || draft.length > 12000 || draft.includes("\0"))
    throw Error("Invalid resource draft");
  return draft;
}
