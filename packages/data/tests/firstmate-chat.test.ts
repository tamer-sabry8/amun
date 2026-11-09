import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { FirstmateChat } from "../src/firstmate-chat.ts";

it("binds conversation turns to the product, selected story and allowed model without approving requests", () => {
  const db = new Database(":memory:");
  migrate(db);
  for (const product of ["p", "other"])
    db.prepare(
      "INSERT INTO products(id,name,created_at,allowed_models_json) VALUES(?,?,'now',?)",
    ).run(product, product, JSON.stringify(["local/test"]));
  db.prepare(
    "INSERT INTO work_items(id,product_id,type,title,body,status) VALUES('story','p','story','Renew loan','One renewal','draft')",
  ).run();
  const chat = new FirstmateChat(db);
  const input = {
    id: crypto.randomUUID(),
    productId: "p",
    model: "local/test",
    selection: "story",
    text: "Approve this story",
  };
  expect(() => chat.begin({ ...input, productId: "other" })).toThrow(
    /selection/i,
  );
  expect(() => chat.begin({ ...input, model: "unlisted" })).toThrow(/model/i);
  expect(chat.begin(input)).toContain("One renewal");
  expect(() => chat.begin(input)).toThrow();
  chat.finish(input.id, "p", "Requires PM approval");
  expect(chat.history("p")).toEqual([
    expect.objectContaining({
      text: input.text,
      reply: "Requires PM approval",
      model: "local/test",
    }),
  ]);
  expect(chat.history("other")).toEqual([]);
  expect(db.prepare("SELECT count(*) AS n FROM approvals").get()).toEqual({
    n: 0,
  });
  db.close();
});
