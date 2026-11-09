import { ModelRoutes } from "./model-routes.tsx";
import type { FormEvent } from "react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";

export function ProductContext({
  context,
  creating,
  onCancel,
}: {
  context: WorkspaceSnapshot["productContext"];
  creating: boolean;
  onCancel(): void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const fields = creating
      ? {
          action: "create-product",
          name: field("name"),
          allowedModels: field("models")
            .split(",")
            .map((model) => model.trim())
            .filter(Boolean),
        }
      : {
          action: "map-source",
          productId: context?.productId,
          sourceKind: field("kind"),
          title: field("title"),
          reference: field("reference"),
        };
    bridge.send({ version: 1, kind: "workspace", ...fields });
  }
  if (creating)
    return (
      <section>
        <h2>New product</h2>
        <form onSubmit={submit}>
          <label>
            Product name
            <input name="name" required maxLength={256} />
          </label>
          <label>
            Allowed models (comma-separated IDs)
            <input name="models" />
          </label>
          <button>Create product</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </form>
      </section>
    );
  if (!context) return null;
  return (
    <section aria-label="Product context">
      <h2>Product context</h2>
      <h3>Allowed models</h3>
      <ul>
        {context.allowedModels.map((model) => (
          <li key={model}>{model}</li>
        ))}
      </ul>
      <details>
        <summary>Edit allowed models</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const models = String(
              new FormData(event.currentTarget).get("models") ?? "",
            )
              .split(",")
              .map((model) => model.trim())
              .filter(Boolean);
            bridge.send({
              version: 1,
              kind: "workspace",
              action: "product-models",
              productId: context.productId,
              allowedModels: models,
            });
          }}
        >
          <label>
            Model IDs (provider/model, comma-separated)
            <input
              name="models"
              defaultValue={context.allowedModels.join(", ")}
            />
          </label>
          <button>Save allowed models</button>
        </form>
      </details>
      <ModelRoutes context={context} />
      <h3>Sources</h3>
      <label>
        Import document
        <input
          type="file"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file)
              bridge.send({
                version: 1,
                kind: "document-import",
                productId: context.productId,
                name: file.name,
                bytes:
                  file.size > 8 * 1024 * 1024
                    ? null
                    : new Uint8Array(await file.arrayBuffer()),
              });
          }}
        />
      </label>
      <ul>
        {context.sources.map((source) => (
          <li key={source.id}>
            {source.title} {source.reference}
          </li>
        ))}
      </ul>
      <form onSubmit={submit}>
        <label>
          Source type
          <select name="kind">
            <option value="document">Document</option>
            <option value="repo">Repository</option>
            <option value="ado">Azure DevOps</option>
            <option value="notion">Notion</option>
          </select>
        </label>
        <label>
          Source title
          <input name="title" required maxLength={512} />
        </label>
        <label>
          Source reference
          <input name="reference" required maxLength={2048} />
        </label>
        <button>Map source</button>
      </form>
      {context.sources.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            bridge.send({
              version: 1,
              kind: "product-authoring",
              action: "interview",
              productId: context.productId,
              model: form.get("model"),
              objective: form.get("objective"),
            });
          }}
        >
          <label>
            Product objective
            <textarea name="objective" required maxLength={4096} />
          </label>
          <label>
            Interview model
            <select name="model">
              {context.allowedModels.map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
          </label>
          <button disabled={!context.allowedModels.length}>
            Start Firstmate interview
          </button>
        </form>
      )}
      <h3>Memory</h3>
      {context.sources.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            bridge.send({
              version: 1,
              kind: "workspace",
              action: "pin-decision",
              productId: context.productId,
              sourceId: form.get("source"),
              text: form.get("decision"),
            });
          }}
        >
          <label>
            Decision source
            <select name="source">
              {context.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Product decision
            <input name="decision" required maxLength={4096} />
          </label>
          <button>Pin decision</button>
        </form>
      )}
      <ul>
        {context.memory.map((entry) => (
          <li key={entry.id}>
            {entry.type} · {JSON.stringify(entry.data)}
          </li>
        ))}
      </ul>
    </section>
  );
}
