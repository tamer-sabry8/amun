import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";
it("turns a source-grounded Firstmate question into a Request and retains the answer's provenance", async () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const s = new WorkspaceService(db);
    const send = (action: string, fields: Record<string, unknown>) =>
      s.handle({ version: 1, kind: "workspace", action, ...fields });
    send("create-product", {
      name: "Amun",
      allowedModels: ["local/firstmate"],
    });
    const productId = s.snapshot().preferences.productId!;
    await s.importDocument({
      version: 1,
      kind: "document-import",
      name: "brief.txt",
      productId,
      bytes: new TextEncoder().encode(
        "Require a source for each product decision.",
      ),
    });
    const sourceId = s.snapshot().productContext!.sources[0]!.id;
    send("pin-decision", { productId, sourceId, text: "Keep one crew home" });
    const request = {
      version: 1,
      kind: "product-authoring",
      action: "interview",
      productId,
      objective: "Draft a traceable PRD",
      model: "local/firstmate",
    };
    const firstmate = async (
      model: string,
      instruction: string,
      context: string,
    ) => {
      expect(model).toBe(request.model);
      expect(context).toContain("Require a source");
      expect(context).toContain(request.objective);
      expect(context).toContain("Keep one crew home");
      expect(instruction).toMatch(/question/i);
      return JSON.stringify({
        question: "Which evidence should a reviewer see?",
        sourceIds: [sourceId],
      });
    };
    expect(await s.author(request, firstmate)).toMatchObject({
      attention: [
        {
          ask: "Which evidence should a reviewer see?",
          origin: { kind: "firstmate" },
          type: "answer",
        },
      ],
    });
    const item = s.snapshot().attention[0]!;
    expect(
      send("resolve", {
        id: item.id,
        source: "review",
        answer: "Show the original brief and its hash.",
      }),
    ).toMatchObject({ attention: [{ state: "resolved" }] });
    const decision = db
      .prepare("SELECT chosen,sources_json FROM decisions")
      .get() as { chosen: string; sources_json: string };
    expect(decision.chosen).toContain("original brief");
    expect(JSON.parse(decision.sources_json)).toEqual(
      expect.arrayContaining([item.id, sourceId]),
    );
    const objectiveId = item.origin.firstmateRef!;
    const understanding = {
      facts: "Use the approved brief.",
      assumptions: "The reviewer has access.",
      questions: "Who reviews revisions?",
    };
    expect(
      send("save-understanding", {
        productId,
        objectiveId,
        expectedVersion: 0,
        ...understanding,
      }),
    ).toMatchObject({
      productContext: {
        objectives: [
          { understanding: { ...understanding, version: 1, approved: false } },
        ],
      },
    });
    expect(
      send("save-understanding", {
        productId,
        objectiveId,
        expectedVersion: 0,
        ...understanding,
      }),
    ).toMatchObject({ kind: "workspace-error" });
    expect(
      send("approve-understanding", {
        productId,
        objectiveId,
        expectedVersion: 1,
      }),
    ).toMatchObject({
      productContext: { objectives: [{ understanding: { approved: true } }] },
    });
    const draft = {
      version: 1,
      kind: "product-authoring",
      action: "draft",
      objectiveId,
      productId,
      model: request.model,
      expectedVersion: 0,
      understandingVersion: 1,
      selection: "",
    };
    expect(
      await s.author(draft, async (_model, _instruction, context) => {
        expect(JSON.parse(context).understanding).toMatchObject({
          ...understanding,
          version: 1,
          approved: true,
        });
        return JSON.stringify({
          markdown: "# Sourced requirements\n\nShow the original brief [S1].",
          sourceIds: [sourceId],
          rationale: "Traceability",
        }).replaceAll("\\n", "\n");
      }),
    ).toMatchObject({ kind: "workspace-snapshot" });
    const current = () => s.snapshot().productContext!.objectives[0]!;
    const proposal = current().proposal!;
    expect(current().prd).toBeNull();
    expect(
      send("apply-proposal", {
        objectiveId,
        productId,
        proposalId: proposal.id,
        expectedVersion: 0,
      }),
    ).toMatchObject({ kind: "workspace-snapshot" });
    const original = current().prd!;
    expect(original.version).toBe(1);
    const annotate = (intent: string, selection: string) =>
      send("prd-selection", {
        productId,
        objectiveId,
        expectedVersion: 1,
        intent,
        selection,
      });
    expect(annotate("link", "Unrecognized selection")).toMatchObject({
      kind: "workspace-error",
    });
    for (const intent of ["link", "story", "source", "assumption", "story"])
      expect(annotate(intent, "Show the original brief")).toMatchObject({
        kind: "workspace-snapshot",
      });
    expect(
      db
        .prepare("SELECT count(*) AS n FROM work_items WHERE type='story'")
        .get(),
    ).toEqual({ n: 1 });
    expect(current().links).toHaveLength(4);

    expect(
      send("approve-prd", {
        productId,
        objectiveId,
        expectedVersion: 1,
        markdown: original.markdown,
      }),
    ).toMatchObject({ kind: "workspace-snapshot" });
    expect(current().prd).toMatchObject({ approved: true });
    const stories = {
      version: 1,
      kind: "product-authoring",
      action: "stories",
      model: request.model,
      productId,
      objectiveId,
      expectedVersion: 1,
    };
    const make = (quote: string) =>
      JSON.stringify({
        stories: [
          {
            title: "Read the brief",
            requirement: quote,
            acceptance: ["The brief is visible."],
            tasks: ["Render the brief"],
          },
        ],
      });
    expect(
      await s.author(stories, async () => make("Invented requirement")),
    ).toMatchObject({ kind: "workspace-error" });
    expect(
      await s.author(stories, async () => make("Show the original brief")),
    ).toMatchObject({ kind: "workspace-snapshot" });
    const generated = () => s.snapshot().productContext!.storyDrafts;
    expect(generated()).toHaveLength(2);
    expect(generated()[0]).toMatchObject({
      title: "Read the brief",
      version: 1,
      requirement: "Show the original brief",
    });
    expect(generated()[1]!.parentId).toBe(generated()[0]!.id);
    expect(
      await s.author(stories, async () => {
        throw Error("duplicate model call");
      }),
    ).toMatchObject({ kind: "workspace-snapshot" });

    const itemId = generated()[0]!.id;
    const storyDecision = {
      question: "Which review duration?",
      options: ["7 days", "14 days"],
      proposed: "7 days",
      missing: "Confirm the review policy.",
    };
    expect(
      await s.author(
        {
          version: 1,
          kind: "product-authoring",
          action: "story-decision",
          productId,
          itemId,
          model: request.model,
        },
        async () => JSON.stringify(storyDecision),
      ),
    ).toMatchObject({ kind: "workspace-snapshot" });
    const storyRequestId = s.snapshot().productContext!.storyDecisions[0]!.id;
    const review = (action: string, choice = "7 days", confirmation = "") =>
      send("review-story-decision", {
        productId,
        requestId: storyRequestId,
        operation: action,
        choice,
        confirmation,
      });
    expect(review("resolve")).toMatchObject({ kind: "workspace-error" });
    expect(review("save")).toMatchObject({ kind: "workspace-snapshot" });
    expect(review("request")).toMatchObject({ kind: "workspace-snapshot" });
    expect(review("later")).toMatchObject({ kind: "workspace-snapshot" });
    expect(review("resolve", "14 days", "PM confirmed policy")).toMatchObject({
      kind: "workspace-snapshot",
    });
    expect(s.snapshot().productContext!.storyDecisions[0]).toMatchObject({
      state: "resolved",
      choice: "14 days",
      requirementId: generated()[0]!.requirementId,
    });
    expect(
      db.prepare("SELECT body FROM work_items WHERE id=?").get(itemId),
    ).toMatchObject({ body: expect.stringContaining("14 days") });
    expect(
      send("save-prd", {
        productId,
        objectiveId,
        expectedVersion: 1,
        markdown: "Updated requirement.",
      }),
    ).toMatchObject({ kind: "workspace-snapshot" });
    expect(current().prd).toMatchObject({
      version: 2,
      approved: false,
      invalidated: expect.stringContaining("v1"),
    });
    expect(
      send("save-prd", {
        productId,
        objectiveId,
        expectedVersion: 1,
        markdown: "Stale change",
      }),
    ).toMatchObject({ kind: "workspace-error" });
    expect(current().prd!.history).toHaveLength(2);
    expect(
      await s.author({ ...request, model: "foreign/model" }, async () => {
        throw Error("must never run");
      }),
    ).toMatchObject({ kind: "workspace-error" });
  } finally {
    db.close();
  }
});

it("refuses unavailable or stale context, parallel interviews and foreign source claims without saving a Request", async () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const ws = new WorkspaceService(db);
    const send = (action: string, fields: Record<string, unknown>) =>
      ws.handle({ version: 1, kind: "workspace", action, ...fields });
    send("create-product", { name: "Alpha", allowedModels: ["local/primary"] });
    const productId = ws.snapshot().preferences.productId!;
    const cmd = {
      version: 1,
      kind: "product-authoring",
      action: "interview",
      model: "local/primary",
      productId,
      objective: "Check scope",
    };
    const foreign = async () =>
      JSON.stringify({
        question: "Which date is intended?",
        sourceIds: ["foreign"],
      });
    expect(await ws.author(cmd, foreign)).toMatchObject({
      kind: "workspace-error",
      message: expect.stringContaining("source"),
    });
    send("map-source", {
      productId,
      sourceKind: "document",
      reference: "brief.md",
      title: "Brief",
    });
    expect(await ws.author(cmd, foreign)).toMatchObject({
      kind: "workspace-error",
      message: expect.stringContaining("unrecognized source"),
    });
    const sourceId = ws.snapshot().productContext!.sources[0]!.id;
    let finish!: (value: string) => void;
    const pending = ws.author(
      cmd,
      async () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    expect(await ws.author(cmd, foreign)).toMatchObject({
      kind: "workspace-error",
      message: expect.stringContaining("already working"),
    });
    send("create-product", { name: "Beta", allowedModels: ["local/primary"] });
    finish(
      JSON.stringify({
        question: "Which date is intended?",
        sourceIds: [sourceId],
      }),
    );
    expect(await pending).toMatchObject({
      kind: "workspace-error",
      message: expect.stringContaining("selection changed"),
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM product_interviews").get(),
    ).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});
