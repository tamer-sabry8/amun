// Native Settings panels that replace the earlier embedded surfaces:
// the skill library and encrypted backup controls.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "../bridge.ts";

const template =
  "Summarize the release using source records. Cite each completed item and list unresolved questions.";
// Skills written in the form here were stored as "Custom editor".
const originLabel = (origin: string) =>
  origin === "Custom editor" ? "Written here" : origin;
const firstLine = (text: string) =>
  (
    text.split("\n").find((line) => line.trim() && !line.startsWith("---")) ??
    ""
  )
    .replace(/^#+\s*/, "")
    .slice(0, 140);

export function SkillsPanel({
  context,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
}) {
  const [name, setName] = useState("release-notes"),
    [source, edit] = useState(template),
    [origin, setOrigin] = useState("Amun templates"),
    [files, setFiles] = useState<File[]>([]),
    [address, setAddress] = useState(""),
    [looking, setLooking] = useState(false),
    [removing, setRemoving] = useState<string | null>(null),
    [adding, setAdding] = useState(false);
  const notice = useSyncExternalStore(
    bridge.subscribe,
    () => bridge.getSnapshot().notice,
    () => "",
  );
  const send = (action: string, fields: Record<string, unknown>) =>
    bridge.send({
      version: 1,
      kind: "workspace",
      action,
      productId: context.productId,
      ...fields,
    });
  const reviews = context.skillLibrary?.reviews ?? [],
    installed = context.skillLibrary?.installed ?? [];
  useEffect(() => setLooking(false), [reviews.length, notice]);
  return (
    <section aria-label="Skill library" style={{ display: "grid", gap: 14 }}>
      {reviews.length + installed.length > 0 ? (
        <div className="rb-rows">
          {reviews.map((r) => (
            <div key={r.id} className="rb-rowitem">
              <span>
                <span className="name">{r.name}</span>
                <br />
                <span className="muted small">
                  {firstLine(r.source) || originLabel(r.origin)}
                </span>
                <details>
                  <summary className="link small">
                    Read the instructions
                  </summary>
                  <p className="muted small">From {originLabel(r.origin)}</p>
                  <pre className="small" style={{ whiteSpace: "pre-wrap" }}>
                    {r.source}
                  </pre>
                  <p className="muted small">Fingerprint: {r.digest}</p>
                </details>
              </span>
              <span>
                <span className="tag warn">Needs your review</span>
              </span>
              <span className="row wrap">
                <button
                  className="btn"
                  onClick={() => {
                    send("decide-skill", {
                      review: r.id,
                      digest: r.digest,
                      approve: true,
                    });
                    // The skill is in; the form starts empty for the next one.
                    setName("");
                    edit("");
                    setOrigin("Amun templates");
                    setAdding(false);
                  }}
                >
                  Approve {r.name}
                </button>
                <button
                  className="btn quiet"
                  onClick={() =>
                    send("decide-skill", {
                      review: r.id,
                      digest: r.digest,
                      approve: false,
                    })
                  }
                >
                  Reject {r.name}
                </button>
              </span>
            </div>
          ))}
          {installed.map((s) => (
            <div key={s.name} className="rb-rowitem">
              <span>
                <span className="name">{s.name}</span>
                <br />
                <span className="muted small">
                  From {originLabel(s.origin)}
                </span>
              </span>
              <span>
                <span className="tag good">Reviewed and on</span>
              </span>
              <span className="row wrap">
                {removing === s.name ? (
                  <>
                    <span className="muted small">
                      Remove {s.name}? Firstmate will stop using it.
                    </span>
                    <button
                      className="btn"
                      onClick={() => {
                        send("remove-skill", { name: s.name });
                        setRemoving(null);
                      }}
                    >
                      Yes, remove {s.name}
                    </button>
                    <button
                      className="btn quiet"
                      onClick={() => setRemoving(null)}
                    >
                      Keep {s.name}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn quiet"
                    onClick={() => setRemoving(s.name)}
                  >
                    Remove {s.name}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No skills yet. Add one below.</p>
      )}
      <details
        open={adding}
        onToggle={(event) => setAdding(event.currentTarget.open)}
      >
        <summary className="link">Add a skill</summary>
        <div className="rb-inline" style={{ marginTop: 10 }}>
          <label className="field">
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
          {files.length > 0 && (
            <div className="row wrap">
              {files.map((f) => (
                <button
                  key={f.webkitRelativePath}
                  className="btn quiet"
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
            </div>
          )}
          <form
            style={{ display: "grid", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              setLooking(true);
              bridge.send({
                version: 1,
                kind: "skill-fetch",
                productId: context.productId,
                url: address,
              });
            }}
          >
            <label className="field">
              Or get skills from a Git address
              <input
                type="url"
                required
                placeholder="https://github.com/owner/skills"
                pattern="https://.*"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <span className="row">
              <button className="btn" disabled={looking}>
                Find skills
              </button>
            </span>
            <p className="muted small" role="status" aria-live="polite">
              {looking ? "Looking for skills…" : notice}
            </p>
          </form>
          <form
            style={{ display: "grid", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              send("review-skill", { name, source, origin });
            }}
          >
            <label className="field">
              Skill name
              <input
                required
                pattern="[a-z][a-z0-9\-]{0,63}"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              Skill instructions
              <textarea
                required
                maxLength={12000}
                rows={6}
                value={source}
                onChange={(e) => {
                  edit(e.target.value);
                  setOrigin("Custom editor");
                }}
              />
            </label>
            <p className="note">
              Nothing is used until you have reviewed and approved it.
            </p>
            <span className="row">
              <button className="btn">Preview skill revision</button>
            </span>
          </form>
        </div>
      </details>
    </section>
  );
}

export function BackupPanel() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.data?.kind === "amun-backup-status" &&
        typeof event.data.message === "string"
      )
        setStatus(event.data.message);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const run = (action: string) => {
    window.postMessage(
      { kind: "amun-backup-command", command: { action, password } },
      "*",
    );
    setPassword("");
  };
  return (
    <div className="rb-inline">
      <label className="field">
        Backup passphrase
        <input
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={1024}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <p className="note">
        Use at least 12 characters. Keep this passphrase safe; you need it to
        restore the backup.
      </p>
      <span className="row wrap">
        <button
          className="btn"
          disabled={password.length < 12}
          onClick={() => run("export")}
        >
          Export encrypted backup
        </button>
        <button
          className="btn quiet"
          disabled={password.length < 12}
          onClick={() => run("restore")}
        >
          Restore to new folder
        </button>
      </span>
      <p className="small" aria-live="polite">
        {status}
      </p>
      <p className="note">
        Restore creates a separate workspace folder. It never replaces the
        current workspace or imports sign-ins.
      </p>
    </div>
  );
}
