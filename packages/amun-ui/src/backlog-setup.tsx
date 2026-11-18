import { useEffect, useState, type FormEvent } from "react";
import { bridge } from "./bridge.ts";
import { azureProjectUrl } from "./azure-project-url.ts";

/**
 * Maps (or changes) the Azure DevOps project behind this product's backlog.
 * It only records the address on this Mac; nothing is sent to Azure here.
 */
export function BacklogSetup({
  productId,
  source,
  onDone,
}: {
  productId: string;
  source?: { id: string; title: string; reference: string | null };
  onDone?: () => void;
}) {
  const [title, setTitle] = useState(source?.title ?? "");
  const [url, setUrl] = useState(source?.reference ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(
    () =>
      bridge.onEvent((event) => {
        if (
          saving &&
          event &&
          typeof event === "object" &&
          "kind" in event &&
          event.kind === "workspace-error"
        ) {
          setSaving(false);
          setError("That could not be saved. Check the address and try again.");
        }
      }),
    [saving],
  );
  // A saved mapping arrives as a changed source list, which closes the form.
  useEffect(() => {
    if (saving && source?.reference && source.reference === url.trim()) {
      setSaving(false);
      onDone?.();
    }
  }, [saving, source?.reference]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const checked = azureProjectUrl(url);
    if (!checked.ok) return setError(checked.error);
    const name = title.trim() || checked.project;
    if (name.length > 512) return setError("The name is too long.");
    setError("");
    setSaving(true);
    bridge.send({
      version: 1,
      kind: "workspace",
      action: "map-source",
      productId,
      ...(source ? { sourceId: source.id } : {}),
      sourceKind: "ado",
      title: name,
      reference: checked.url,
    });
  }
  return (
    <form onSubmit={submit} aria-label="Connect an Azure DevOps project">
      <label>
        Project address
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://devops.example.com/Collection/Project"
          inputMode="url"
          autoComplete="off"
          maxLength={2048}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "backlog-setup-error" : undefined}
        />
      </label>
      <label>
        Name
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Defaults to the project name"
          maxLength={512}
        />
      </label>
      {error && (
        <p id="backlog-setup-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={saving}>
        {source ? "Save changes" : "Connect project"}
      </button>
    </form>
  );
}
