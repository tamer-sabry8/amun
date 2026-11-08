import { createHash } from "node:crypto";
import { stowFiles as memoryFiles } from "../../contracts/src/stow.ts";
export { memoryFiles };
export type MemoryFile = (typeof memoryFiles)[number];
export type Memory = Record<MemoryFile, string>;
export type Edit = { file: MemoryFile; previous: string; text: string };
export const stowHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function planStow(
  initial: Memory,
  edits: Edit[],
  evidence: string,
  date: string,
  approved = "",
) {
  const memory = { ...initial },
    pins: { id: string; edit: Edit }[] = [];
  for (const edit of edits) {
    const { file, previous, text } = edit;
    if (
      !memoryFiles.includes(file) ||
      !text.trim() ||
      text !== text.trim() ||
      text.length > 1200 ||
      /[\r\n\p{Cc}\p{Cf}]|<!--|-->/u.test(text) ||
      !evidence.includes(text)
    )
      continue;
    const lines = memory[file].split("\n");
    if (
      previous &&
      (!previous.startsWith("- ") ||
        lines.filter((l) => l === previous).length !== 1 ||
        /<!--(?!P-->|[ap]:[\d/-]+-->|g-->)/.test(previous))
    )
      continue;
    if (
      lines.some(
        (l) => l.replace(/^- /, "").replace(/\s*<!--.*?-->\s*$/, "") === text,
      )
    )
      continue;
    const metadata = previous.trimEnd();
    if ((metadata.match(/<!--/g) ?? []).length > 1) continue;
    const dated = /<!--([ap]):[\d/-]+-->$/.exec(metadata);
    const pinned =
      previous &&
      (/<!--P-->/.test(metadata) || (file !== "learnings.md" && !dated));
    const id = stowHash(JSON.stringify([file, previous, text]));
    if (pinned && id !== approved) {
      pins.push({ id, edit });
      continue;
    }
    const tier = dated?.[1] ?? (file === "learnings.md" ? "a" : "");
    const marker = /<!--P-->/.test(metadata)
      ? " <!--P-->"
      : tier
        ? " <!--" + tier + ":" + date + "-->"
        : "";
    const line = "- " + text + marker;
    if (previous) {
      lines[lines.indexOf(previous)] = line;
      memory[file] = lines.join("\n");
    } else
      memory[file] +=
        (memory[file] && !memory[file].endsWith("\n") ? "\n" : "") +
        line +
        "\n";
  }
  return { memory, pins };
}

export function ageLearnings(memory: string, evidence: string, date: string) {
  const archive: string[] = [];
  const lines = memory.split("\n");
  const text = lines
    .flatMap((line, index) => {
      if (!line.startsWith("- ") || /^\s+\S/.test(lines[index + 1] ?? ""))
        return [line];
      const match =
        /^- (.+?)(?: <!--(a|p):([\d-]{10})(?:\/\d+)?-->| <!--(g)-->)?$/.exec(
          line,
        );
      if (!match || match[1]!.includes("<!--")) return [line];
      const [, fact, tier, last, grace] = match;
      const reinforced = evidence.split("\n").some((s) => s.trim() === fact);
      if (reinforced)
        return ["- " + fact + " <!--" + (tier ?? "a") + ":" + date + "-->"];
      if (!last && !grace) return [line + " <!--g-->"];
      const age = (Date.parse(date) - Date.parse(last ?? "")) / 86400000;
      if (!grace && !(age >= (tier === "p" ? 7 : 30))) return [line];
      archive.push(
        "- (from learnings.md, tier: " +
          (tier === "p" ? "perishable" : "aging") +
          ", reinforced: " +
          (last ?? "unknown") +
          ") " +
          fact +
          " [archived: " +
          (grace ? "legacy-unvalidated" : "unreinforced") +
          "]",
      );
      return [];
    })
    .join("\n");
  return { text, archive };
}
