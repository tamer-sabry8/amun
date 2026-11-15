import { describe, expect, it } from "vitest";
import {
  readNotionPage,
  updateNotionPage,
  updatedContent,
  type NotionPageSnapshot,
} from "../src/notion-page-update.ts";
import { lineDiff } from "../../domain/src/notion-update.ts";

const page = "11111111-2222-4333-8444-555555555555";
const parent = "41735810-e3a9-80ea-ae45-d78ca230f0a3";
const fetched = (content: string, extra: object = {}) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        url: "https://www.notion.so/" + page.replaceAll("-", ""),
        metadata: { type: "page" },
        text:
          `<page url="x">\n<ancestor-path>\n<parent-page url="https://www.notion.so/${parent.replaceAll("-", "")}"/>\n</ancestor-path>\n` +
          `<properties>\n{"title":"QA notes"}\n</properties>\n<content>\n${content}\n</content>\n</page>`,
        ...extra,
      }),
    },
  ],
});

describe("reading a Notion page", () => {
  it("reads the parent, title and content, and notices any edit", () => {
    const one = readNotionPage(fetched("Hello"), page);
    expect(one).toMatchObject({
      title: "QA notes",
      content: "Hello",
      parent,
      trashed: false,
    });
    expect(readNotionPage(fetched("Hello"), page).version).toBe(one.version);
    expect(readNotionPage(fetched("Hello!"), page).version).not.toBe(
      one.version,
    );
    expect(
      readNotionPage(
        fetched("Hello", { last_edited_time: "2026-11-15T10:00:00.000Z" }),
        page,
      ).version,
    ).not.toBe(one.version);
  });
  it("refuses a different page than the one asked for", () => {
    expect(() =>
      readNotionPage(fetched("Hello"), "99999999-2222-4333-8444-555555555555"),
    ).toThrow();
  });
});

describe("updating a page Amun wrote", () => {
  const base = readNotionPage(fetched("Old text"), page);
  const update = {
    pageId: page,
    expectedVersion: base.version,
    parentId: parent,
    titleProperty: "title",
    title: "QA notes",
    text: "New text",
    marker: "m-1",
  };
  const io = (now: NotionPageSnapshot[], calls: string[] = []) => ({
    read: async () => (now.length > 1 ? now.shift()! : now[0]!),
    call: async (command: string, body: object) => {
      calls.push(command + ":" + JSON.stringify(body));
      return true;
    },
    beforeSend: () => calls.push("send"),
  });
  it("replaces the content when the page is as Amun left it", async () => {
    const calls: string[] = [];
    const after = readNotionPage(fetched("New text"), page);
    expect(await updateNotionPage(update, io([base, after], calls))).toEqual({
      state: "updated",
      version: after.version,
    });
    expect(calls).toEqual(["send", 'replace_content:{"new_str":"New text"}']);
  });
  it("stops without writing when someone edited the page in Notion", async () => {
    const calls: string[] = [];
    const edited = readNotionPage(fetched("Someone else wrote this"), page);
    expect(await updateNotionPage(update, io([edited], calls))).toEqual({
      state: "changed",
      url: edited.url,
    });
    expect(calls).toEqual([]);
  });
  it("never writes to a page outside the approved destination or a deleted one", async () => {
    const calls: string[] = [];
    expect(
      await updateNotionPage(
        { ...update, parentId: "99999999-2222-4333-8444-555555555555" },
        io([base], calls),
      ),
    ).toEqual({ state: "elsewhere" });
    expect(
      await updateNotionPage(update, io([{ ...base, trashed: true }], calls)),
    ).toEqual({ state: "gone" });
    expect(calls).toEqual([]);
  });
  it("reports an unconfirmed change as unknown, never as done", async () => {
    const failing = {
      ...io([base]),
      call: async () => false,
    };
    expect(await updateNotionPage(update, failing)).toEqual({
      state: "unknown",
    });
  });
  it("changes the title only when it differs, and keeps the marker line", async () => {
    const calls: string[] = [];
    const marked = readNotionPage(
      fetched("Old text\n\nAmun publication ID: m-1"),
      page,
    );
    await updateNotionPage(
      { ...update, expectedVersion: marked.version, title: "Renamed" },
      io([marked], calls),
    );
    expect(calls[1]).toContain("New text\\n\\nAmun publication ID: m-1");
    expect(calls[2]).toBe(
      'update_properties:{"properties":{"title":"Renamed"}}',
    );
    expect(updatedContent(update, "Old text")).toBe("New text");
  });
});

describe("the exact change", () => {
  it("shows added, removed and unchanged lines", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });
});
