import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { openWorkspace } from "../../packages/data/src/workspace.ts";
import { WorkspaceService } from "../../packages/data/src/workspace-service.ts";
export function acceptanceDb(profile: string) {
  const Native = createRequire(resolve("packages/data/package.json"))(
    "better-sqlite3",
  );
  return openWorkspace(join(profile, "workspace"), Native);
}
/** Stage a synthetic approved PRD and child task through the application service. */
export async function acceptanceDrafts(
  profile: string,
  collection: string,
  project: string,
  tasks = ["Test Task"],
) {
  const db = acceptanceDb(profile);
  try {
    const ws = new WorkspaceService(db);
    const send = (action: string, fields: Record<string, unknown>) => {
      const r = ws.handle({ version: 1, kind: "workspace", action, ...fields });
      if (r?.kind !== "workspace-snapshot")
        throw Error("Fixture action failed: " + action);
    };
    let c = ws.snapshot().productContext;
    if (!c) {
      send("create-product", {
        name: "Backlog acceptance",
        allowedModels: ["local/acceptance"],
      });
      c = ws.snapshot().productContext!;
    }
    const productId = c.productId;
    if (!c.sources.some((x) => x.kind === "ado"))
      send("map-source", {
        productId,
        sourceKind: "ado",
        title: project,
        reference: collection + project,
      });
    if (!ws.snapshot().productContext!.storyDrafts.length) {
      send("product-models", {
        productId,
        allowedModels: ["local/acceptance"],
      });
      const source = ws.snapshot().productContext!.sources[0]!;
      const model = "local/acceptance",
        requirement = "Show the verified result for each test item.";
      const author = async (
        fields: Record<string, unknown>,
        output: unknown,
      ) => {
        const r = await ws.author(
          {
            version: 1,
            kind: "product-authoring",
            productId,
            model,
            ...fields,
          },
          async () => JSON.stringify(output),
        );
        if (r.kind !== "workspace-snapshot")
          throw Error("Fixture authoring failed");
      };
      await author(
        { action: "interview", objective: "Verify the test backlog workflow." },
        {
          question: "What should each test item show?",
          sourceIds: [source.id],
        },
      );
      const q = ws
        .snapshot()
        .attention.find((x) => x.state === "open" && x.type === "answer")!;
      send("resolve", { id: q.id, source: "review", answer: requirement });
      const objectiveId = q.origin.firstmateRef!;
      send("save-prd", {
        productId,
        objectiveId,
        expectedVersion: 0,
        markdown: requirement,
      });
      send("approve-prd", {
        productId,
        objectiveId,
        expectedVersion: 1,
        markdown: requirement,
      });
      await author(
        { action: "stories", objectiveId, expectedVersion: 1 },
        {
          stories: [
            {
              title: "Test PBI",
              requirement,
              acceptance: ["The result is visible."],
              tasks,
            },
          ],
        },
      );
    }
    return ws.snapshot().productContext!;
  } finally {
    db.close();
  }
}
