import Database from "better-sqlite3";
import { ActionStore, dispatchOne } from "../../src/outbox.ts";
const [file, url] = process.argv.slice(2);
if (!file || !url) throw Error("Missing test configuration");
const db = new Database(file);
const store = new ActionStore(db);
store.recover();
await dispatchOne(store, {
  kind: "publish",
  execute: async (action) => {
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ marker: action.operationMarker }),
    });
    if (!response.ok) throw Error("Remote write failed");
  },
  reconcile: async (marker) => {
    const response = await fetch(url + "?marker=" + encodeURIComponent(marker));
    if (!response.ok) throw Error("Reconciliation failed");
    return (await response.json()) as { state: "found" | "absent" | "unknown" };
  },
});
db.close();
