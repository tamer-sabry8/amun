import { useState } from "react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import type { MemoryLink } from "../../../packages/contracts/src/memory-sync.ts";
import { bridge } from "./bridge.ts";
type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
export function MemoryLinks({ context }: { context: Context }) {
  const [selection, setSelection] = useState("");
  const fields = context.memory.flatMap((record) => {
    if (
      !record.data ||
      Array.isArray(record.data) ||
      typeof record.data !== "object"
    )
      return [];
    return Object.entries(record.data)
      .filter(
        ([name, value]) =>
          /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/.test(name) &&
          typeof value === "string" &&
          value.length > 0,
      )
      .map(([field]) => ({
        record: record.id,
        field,
        description:
          record.type +
          " · " +
          context.sources.find((s) => s.id === record.sourceId)?.title +
          " · " +
          field,
      }));
  });
  const send = (action: string, details: Record<string, unknown>) =>
    bridge.send({
      version: 1,
      kind: "workspace",
      action,
      productId: context.productId,
      ...details,
    });
  const choose = (link: MemoryLink, choice: string) =>
    send("sync-memory-field", { choice, link: link.id, review: link });
  if (!fields.length && !context.memoryLinks?.length) return null;
  return (
    <section aria-label="Notion memory sync">
      <h3>Notion memory sync</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const entry = fields[Number(selection || 0)];
          if (entry)
            send("link-memory", {
              record: entry.record,
              field: entry.field,
              label: data.get("label"),
              url: data.get("url"),
            });
        }}
      >
        <label>
          Product memory field
          <select
            value={selection || "0"}
            onChange={(e) => setSelection(e.target.value)}
          >
            {fields.map((f, i) => (
              <option key={f.record + f.field} value={i}>
                {f.description}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notion page URL
          <input name="url" type="url" required />
        </label>
        <label>
          Notion field label
          <input
            name="label"
            required
            pattern="[A-Za-z][A-Za-z0-9 _\-]{0,63}"
          />
        </label>
        <p>
          Map a page-body line written as “Label: value”. A following text line
          anchors reviewed updates.
        </p>
        <button>Link selected field</button>
      </form>
      {(context.memoryLinks ?? []).map((link) => (
        <article key={link.id}>
          <h4>{link.label}</h4>
          <p>
            {link.state} · <code>{link.page}</code>
          </p>
          <dl>
            <dt>Amun · {link.field}</dt>
            <dd>{link.local}</dd>
            <dt>Notion · {link.label}</dt>
            <dd>{link.remote ?? "No current value"}</dd>
          </dl>
          <form
            key={link.local}
            onSubmit={(e) => {
              e.preventDefault();
              send("edit-memory-field", {
                link: link.id,
                before: link.local,
                value: new FormData(e.currentTarget).get("value"),
              });
            }}
          >
            <label>
              Local value
              <input
                name="value"
                defaultValue={link.local}
                maxLength={4096}
                required
              />
            </label>
            <button>Save local edit</button>
          </form>
          <button onClick={() => choose(link, "refresh")}>
            Check Notion field
          </button>
          {["incoming", "conflict"].includes(link.state) && (
            <button onClick={() => choose(link, "take-remote")}>
              Apply reviewed Notion value locally
            </button>
          )}
          {["outgoing", "conflict"].includes(link.state) && (
            <button onClick={() => choose(link, "publish-local")}>
              Approve replacing Notion value with displayed Amun value
            </button>
          )}
          {link.state === "deleted" && (
            <button onClick={() => choose(link, "keep-local")}>
              Keep local value and retain link
            </button>
          )}
          {link.state === "deleted" && (
            <button onClick={() => choose(link, "delete-local")}>
              Delete mapped local field and unlink
            </button>
          )}
          <button onClick={() => choose(link, "unlink")}>
            Keep local value and unlink
          </button>
        </article>
      ))}
    </section>
  );
}
