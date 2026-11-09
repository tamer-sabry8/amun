import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function Tasks({
  context,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
}) {
  const send = (action: string, details: Record<string, unknown>) =>
    bridge.send({
      version: 1,
      kind: "workspace",
      action,
      productId: context.productId,
      ...details,
    });
  return (
    <details>
      <summary>Tasks and reminders</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          send("save-task", {
            title: f.get("title"),
            category: f.get("category"),
            due: new Date(String(f.get("due"))).toISOString(),
            consequential: f.has("approval"),
          });
        }}
      >
        <label>
          Task title
          <input name="title" required maxLength={512} />
        </label>
        <label>
          Category
          <select name="category">
            <option value="personal">Personal</option>
            <option value="work">Work</option>
          </select>
        </label>
        <label>
          Remind me at
          <input type="datetime-local" name="due" required />
        </label>
        <label>
          <input type="checkbox" name="approval" />
          Requires review
        </label>
        <button>Schedule reminder</button>
      </form>
      <ul>
        {context.tasks?.map((t) => (
          <li key={t.id}>
            {t.title} · {t.category} · {new Date(t.due).toLocaleString()} ·{" "}
            {t.state}{" "}
            {t.state !== "completed" && (
              <button
                onClick={() =>
                  send("complete-task", {
                    task: t.id,
                    title: t.title,
                    due: t.due,
                    confirm: t.consequential,
                  })
                }
              >
                {t.consequential ? "Approve task completion" : "Mark complete"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
