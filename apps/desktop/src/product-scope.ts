import type Database from "better-sqlite3";
/** Returns the product id when it exists and the service is open, else null. */
export const productScope =
  (db: Database.Database, closed: () => boolean) => (id: string) =>
    closed() || !db.prepare("SELECT 1 FROM products WHERE id=?").pluck().get(id)
      ? null
      : id;
