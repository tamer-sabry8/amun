import { ModelRouting } from "./model-routing.ts";
import type Database from "better-sqlite3";
import {
  chatTurn,
  chatRecord,
  type ChatTurn,
} from "../../contracts/src/firstmate-chat.ts";
export class FirstmateChat {
  constructor(private db: Database.Database) {}
  model(t: ChatTurn) {
    return new ModelRouting(this.db).resolve(
      t.productId,
      "conversation",
      t.difficulty ?? "standard",
      t.model,
    );
  }
  history(productId: string) {
    return this.db
      .prepare(
        "SELECT id,model,text,reply,state FROM firstmate_chat WHERE product_id=? ORDER BY rowid DESC LIMIT 30",
      )
      .all(productId)
      .reverse()
      .map((x) => chatRecord.parse(x));
  }
  begin(input: ChatTurn) {
    const t = chatTurn.parse(input);
    const product = this.db
      .prepare("SELECT allowed_models_json FROM products WHERE id=?")
      .get(t.productId) as { allowed_models_json: string } | undefined;
    if (!product || !JSON.parse(product.allowed_models_json).includes(t.model))
      throw Error("Choose a model allowed for this product.");
    const selected = t.selection
      ? this.db
          .prepare(
            "SELECT id,title,body FROM work_items WHERE product_id=? AND id=? UNION ALL SELECT id,ask AS title,detail AS body FROM attention_items WHERE product_id=? AND id=?",
          )
          .get(t.productId, t.selection, t.productId, t.selection)
      : null;
    if (t.selection && !selected)
      throw Error("Selection is unavailable in this product.");
    const history = this.history(t.productId)
      .filter((x) => x.state === "answered")
      .slice(-10)
      .map((x) => ({
        user: x.text.slice(0, 1000),
        firstmate: x.reply?.slice(0, 1000),
      }));
    this.db
      .prepare(
        "INSERT INTO firstmate_chat(id,product_id,model,selection,text,state) VALUES(?,?,?,?,?,'working')",
      )
      .run(t.id, t.productId, t.model, t.selection, t.text);
    return JSON.stringify({ history, selected, message: t.text });
  }
  finish(id: string, product: string, reply: string | null) {
    this.db
      .transaction(() => {
        const change = this.db
          .prepare(
            "UPDATE firstmate_chat SET reply=?,state=? WHERE id=? AND product_id=? AND state='working'",
          )
          .run(reply, reply === null ? "interrupted" : "answered", id, product);
        if (reply !== null && change.changes) {
          const row = this.db
            .prepare("SELECT model FROM firstmate_chat WHERE id=?")
            .get(id) as { model: string };
          new ModelRouting(this.db).record(
            product,
            id,
            row.model,
            "conversation",
          );
        }
      })
      .immediate();
  }
  recover() {
    this.db
      .prepare(
        "UPDATE firstmate_chat SET state='interrupted' WHERE state='working'",
      )
      .run();
  }
}
