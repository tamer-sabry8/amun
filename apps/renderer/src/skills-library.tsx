import { useState } from "react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";
const template =
  "Summarize the release using source records. Cite each completed item and list unresolved questions.";
export function SkillsLibrary({
  context,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
}) {
  const [name, setName] = useState("release-notes"),
    [source, edit] = useState(template),
    [origin, setOrigin] = useState("Amun templates"),
    [files, setFiles] = useState<File[]>([]);
  const send = (action: string, fields: Record<string, unknown>) =>
    bridge.send({
      version: 1,
      kind: "workspace",
      action,
      productId: context.productId,
      ...fields,
    });
  return (
    <section aria-label="Skill library">
      <label>
        Discover skills in a folder
        <input
          type="file"
          multiple
          {...{ webkitdirectory: "" }}
          onChange={(e) =>
            setFiles(
              Array.from(e.target.files ?? []).filter(
                (f) => f.name === "SKILL.md" && f.size <= 12000,
              ),
            )
          }
        />
      </label>
      {files.map((f) => (
        <button
          key={f.webkitRelativePath}
          onClick={async () => {
            const text = await f.text();
            setName(f.webkitRelativePath.split("/").at(-2) ?? "skill");
            edit(text);
            setOrigin(f.webkitRelativePath);
          }}
        >
          {f.webkitRelativePath}
        </button>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send("review-skill", { name, source, origin });
        }}
      >
        <label>
          Skill name
          <input
            required
            pattern="[a-z][a-z0-9\-]{0,63}"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Skill instructions
          <textarea
            required
            maxLength={12000}
            value={source}
            onChange={(e) => {
              edit(e.target.value);
              setOrigin("Custom editor");
            }}
          />
        </label>
        <button>Preview skill revision</button>
      </form>
      {context.skillLibrary?.reviews.map((r) => (
        <article key={r.id}>
          <h4>{r.name}</h4>
          <p>{r.origin}</p>
          <pre>{r.source}</pre>
          <code>{r.digest}</code>
          <button
            onClick={() =>
              send("decide-skill", {
                review: r.id,
                digest: r.digest,
                approve: true,
              })
            }
          >
            Approve installation
          </button>
          <button
            onClick={() =>
              send("decide-skill", {
                review: r.id,
                digest: r.digest,
                approve: false,
              })
            }
          >
            Reject revision
          </button>
        </article>
      ))}
      {context.skillLibrary?.installed.map((s) => (
        <article key={s.name}>
          <strong>{s.name}</strong>
          <code>{s.digest}</code>
          <button
            onClick={() =>
              send("use-skill", { name: s.name, digest: s.digest })
            }
          >
            Use in Firstmate draft
          </button>
        </article>
      ))}
    </section>
  );
}
