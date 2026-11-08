import { ActionStore } from "../../packages/data/src/outbox.ts";
import { NotionOutboxConnector } from "../../packages/data/src/notion-publication.ts";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../../packages/data/src/database.ts";
import { NotionConversationReview } from "../../packages/data/src/notion-review.ts";
const Database = createRequire(resolve("packages/data/package.json"))(
  "better-sqlite3",
);
test("workspace-scoped publication remains visible without a misleading workspace error", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-publication-status-"));
  mkdirSync(join(root, "workspace"), { mode: 0o700 });
  const file = join(root, "workspace/workspace.sqlite");
  const db = new Database(file);
  migrate(db);
  const review = new NotionConversationReview(db, {
    create: async () => ({ state: "unknown" as const }),
  });
  const item = review.prepare(
    { title: "Test", text: "Reviewed fixture" },
    {
      title: "Documents",
      parentId: "11111111-1111-4111-8111-111111111111",
      parentType: "page_id",
      titleProperty: "title",
    },
    "workspace",
  );
  db.prepare("UPDATE actions SET state='executing' WHERE id=?").run(item.id);
  db.close();
  chmodSync(file, 0o600);
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The workspace change could not be completed.", {
        exact: false,
      }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("conversation sharing is outside model settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-conversation-route-"));
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Models", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Pi commands", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Sign in to Codex CLI", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Share to Notion", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Published conversations", exact: true })
      .click();
    await expect(
      page.getByRole("region", {
        name: "Published conversations",
        exact: true,
      }),
    ).toContainText("No verified publication receipts yet.");

    await expect(
      page.getByRole("button", { name: "Sign in to Codex CLI", exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("service restart reconciles interrupted Notion creates only with matching receipts", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-notion-recovery-"));
  const directory = join(root, "workspace");
  mkdirSync(directory, { mode: 0o700 });
  const file = join(directory, "workspace.sqlite");
  const seed = new Database(file);
  migrate(seed);
  const store = new ActionStore(seed);
  const publisher = {
    create: async () => ({
      state: "created" as const,
      pageId: "22222222-2222-4222-8222-222222222222",
    }),
  };
  const connector = new NotionOutboxConnector(seed, publisher);
  const reviews = new NotionConversationReview(seed, publisher);
  const ids: string[] = [];
  for (const title of ["Missing receipt", "Saved receipt"]) {
    const proposal = reviews.prepare(
      { title, text: "Reviewed fixture" },
      {
        title: "Documents",
        parentId: "11111111-1111-4111-8111-111111111111",
        parentType: "page_id",
        titleProperty: "title",
      },
      "workspace",
    );
    ids.push(proposal.id);
    store.approve(proposal.id, "user");
    const claimed = store.claim("notion_publish", proposal.id)!;
    if (title === "Saved receipt") await connector.execute(claimed);
    else {
      const interrupted = new NotionOutboxConnector(seed, {
        marksSendBoundary: true,
        async create(_payload, context) {
          context.beforeSend();
          return { state: "unknown" };
        },
      });
      await expect(interrupted.execute(claimed)).rejects.toThrow(
        "outcome is unknown",
      );
      expect(reviews.deliveryState(proposal.id)).toBe("sent-unknown");
    }
  }
  seed.close();
  chmodSync(file, 0o600);
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Published conversations", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Unconfirmed publications" }),
    ).toContainText("Missing receipt");
    await expect(
      page.getByLabel("Notion page URL for Saved receipt"),
    ).toHaveValue("https://www.notion.so/22222222222242228222222222222222");
    const verify = new Database(file, { readonly: true });
    try {
      await expect(
        page.getByRole("button", { name: "Retry search", exact: true }),
      ).toBeVisible();
      const read = verify.prepare(
        "SELECT a.state AS action,o.state AS delivery FROM actions a JOIN outbox o ON a.id=o.action_id WHERE a.id=?",
      );
      expect(read.get(ids[0])).toEqual({
        action: "unknown",
        delivery: "unknown",
      });
      expect(read.get(ids[1])).toEqual({
        action: "succeeded",
        delivery: "succeeded",
      });
    } finally {
      verify.close();
    }
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
