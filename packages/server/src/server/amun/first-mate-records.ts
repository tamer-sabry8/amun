import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Which Paseo agent is the First Mate of each Firstmate home. */
export interface FirstMateRecordStore {
  read(fmHome: string): string | null;
  write(fmHome: string, agentId: string): void;
}

/**
 * Kept in Amun's own home (`~/.amun/first-mates.json`), never in the
 * Firstmate home, so a restarted daemon resumes the same First Mate and its
 * conversation instead of starting a second one for the home.
 */
export class FirstMateRecords implements FirstMateRecordStore {
  private readonly file: string;

  constructor(amunHome: string) {
    this.file = path.join(amunHome, "first-mates.json");
  }

  private all(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (typeof saved !== "object" || saved === null) return {};
      const kept: Record<string, string> = {};
      for (const [home, id] of Object.entries(saved))
        if (typeof id === "string" && id) kept[home] = id;
      return kept;
    } catch {
      return {};
    }
  }

  read(fmHome: string): string | null {
    return this.all()[fmHome] ?? null;
  }

  write(fmHome: string, agentId: string): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ ...this.all(), [fmHome]: agentId }), {
      mode: 0o600,
    });
  }
}
