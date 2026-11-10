import { createRequire } from "node:module";
import { resolve } from "node:path";
import { openWorkspace } from "../../packages/data/src/workspace.ts";
import { NotionConversationReview } from "../../packages/data/src/notion-review.ts";

// Standalone service process for the kill-after-commit and lost-response journeys.
const [directory, port] = process.argv.slice(2);
if (!directory || !port || !/^\d+$/.test(port)) throw Error("Missing fixture");
const Database = createRequire(resolve("packages/data/package.json"))(
  "better-sqlite3",
);
const db = openWorkspace(directory, Database);
try {
  const review = new NotionConversationReview(db, {
    marksSendBoundary: true,
    async create(input, context) {
      context.beforeSend();
      await fetch("http://127.0.0.1:" + port, {
        method: "POST",
        body: JSON.stringify(input),
      });
      throw Error("Fixture must interrupt the response");
    },
  });
  const preview = review.prepare(
    { title: "Interrupted publication", text: "Synthetic chaos fixture" },
    {
      title: "Test parent",
      parentType: "page_id",
      parentId: "11111111-1111-4111-8111-111111111111",
      titleProperty: "title",
    },
    "fixture-workspace",
  );
  await review.publish(preview.id, preview.binding);
} finally {
  db.close();
}
