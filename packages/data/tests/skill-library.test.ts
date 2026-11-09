import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { SkillLibrary } from "../src/skill-library.ts";
it("pins and rejects skill revisions before Firstmate can use them", () => {
  const db = new Database(":memory:");
  migrate(db);
  try {
    db.prepare(
      "INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now')",
    ).run();
    const library = new SkillLibrary(db);
    const preview = () =>
      library.review("p", "release-notes", "custom", "Review evidence.");
    const r = preview();
    expect(() => library.use("p", "release-notes", r.digest)).toThrow();
    library.decide("p", r.id, r.digest, false);
    expect(() => library.decide("p", r.id, r.digest, true)).toThrow();
    const installed = preview();
    library.decide("p", installed.id, installed.digest, true);
    expect(library.use("p", "release-notes", installed.digest)).toBe(
      "Review evidence.",
    );
    const update = library.review(
      "p",
      "release-notes",
      "custom",
      "Cite the evidence.",
    );
    expect(() =>
      library.decide("p", update.id, installed.digest, true),
    ).toThrow();
    library.decide("p", update.id, update.digest, true);
    expect(() => library.use("p", "release-notes", installed.digest)).toThrow();
    expect(library.use("p", "release-notes", update.digest)).toBe(
      "Cite the evidence.",
    );
    expect(() =>
      library.use("other", "release-notes", update.digest),
    ).toThrow();
  } finally {
    db.close();
  }
});
