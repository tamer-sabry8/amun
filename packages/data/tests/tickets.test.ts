import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { TicketInbox } from "../src/tickets.ts";
import type { Ticket, TicketAdapter } from "../../domain/src/tickets.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  return db;
};
const ticket = (
  provider: Ticket["provider"],
  id: string,
  changes: Partial<Ticket> = {},
): Ticket => ({
  provider,
  externalId: id,
  title: "Ticket " + id,
  body: "Body",
  url: "https://tracker.example/" + id,
  status: "open",
  priority: 3,
  assignee: "tamer",
  project: "Onboarding",
  labels: [],
  ...changes,
});
const adapter = (
  provider: Ticket["provider"],
  tickets: () => Ticket[],
): TicketAdapter => ({ provider, list: async () => tickets() });

it("gathers tickets from several trackers into one backlog and survives one tracker failing", async () => {
  const db = open();
  const inbox = new TicketInbox(db);
  let jira = [
    ticket("jira", "J-1", { priority: 1 }),
    ticket("jira", "J-2", { body: "token=abc123secret here" }),
  ];
  inbox.connect(adapter("jira", () => jira));
  inbox.connect(
    adapter("linear", () => [
      ticket("linear", "L-1", { priority: 2 }),
      ticket("github", "wrong-provider"),
      ticket("linear", "L-bad", { url: "http://insecure" }),
    ]),
  );
  inbox.connect({
    provider: "plain",
    list: async () => {
      throw new Error("401");
    },
  });
  expect(() => inbox.connect(adapter("jira", () => []))).toThrow(
    /already connected/,
  );
  expect(() => inbox.connect(adapter("trello" as never, () => []))).toThrow(
    /Unsupported/,
  );
  expect(inbox.connected()).toEqual(["jira", "linear", "plain"]);
  expect(await inbox.sync()).toEqual({
    fetched: { jira: 2, linear: 1 },
    failed: ["plain"],
  });
  expect(inbox.list().map((t) => t.externalId)).toEqual(["J-1", "L-1", "J-2"]);
  expect(inbox.get("jira", "J-2").body).not.toContain("abc123secret");
  expect(inbox.list({ providers: ["linear"] })).toHaveLength(1);
  jira = [
    ticket("jira", "J-1", {
      priority: 1,
      status: "in_progress",
      title: "Renamed",
    }),
  ];
  await inbox.sync();
  expect(
    inbox
      .list({ providers: ["jira"] })
      .map((t) => [t.externalId, t.title, t.status]),
  ).toEqual([["J-1", "Renamed", "in_progress"]]);
  db.close();
});

it("starts work on a ticket once, traces the branch back to it, and proposes updates for approval", async () => {
  const db = open();
  const inbox = new TicketInbox(db);
  let tickets = [
    ticket("jira", "AM-104", {
      title: "Invite e-mail overflows",
      reproduction: "Open /invite",
    }),
    ticket("jira", "AM-9", { status: "closed" }),
  ];
  const disconnect = inbox.connect(adapter("jira", () => tickets));
  await inbox.sync("p-missing".length ? undefined : undefined);
  const begun = inbox.begin("jira", "AM-104", "session-1");
  expect(begun).toMatchObject({
    branch: "am-104-invite-e-mail-overflows",
    alreadyStarted: false,
    update: { setStatus: "in_progress" },
  });
  expect(begun.brief).toContain(
    "Task from Jira AM-104: Invite e-mail overflows",
  );
  expect(begun.brief).toContain("Source: https://tracker.example/AM-104");
  expect(inbox.begin("jira", "AM-104")).toMatchObject({
    branch: begun.branch,
    alreadyStarted: true,
  });
  expect(inbox.origin({ branch: begun.branch })?.externalId).toBe("AM-104");
  expect(inbox.origin({ sessionId: "session-1" })?.url).toBe(
    "https://tracker.example/AM-104",
  );
  expect(inbox.origin({ branch: "other" })).toBeNull();
  expect(() => inbox.begin("jira", "AM-9")).toThrow(/already closed/);
  expect(() => inbox.begin("jira", "ghost")).toThrow(/Unknown ticket/);
  expect(() =>
    inbox.delivered("jira", "AM-104", {
      pullRequestUrl: "ftp://x",
      summary: "s",
    }),
  ).toThrow(/https link/);
  expect(
    inbox.delivered("jira", "AM-104", {
      pullRequestUrl: "https://github.com/o/r/pull/9",
      summary: "Fixed with password=hunter2",
    }),
  ).toEqual({
    provider: "jira",
    externalId: "AM-104",
    comment:
      "Pull request: https://github.com/o/r/pull/9\n\nFixed with password=[REDACTED]",
  });
  tickets = [];
  await inbox.sync();
  expect(inbox.list().map((t) => t.externalId)).toEqual(["AM-104"]);
  disconnect();
  expect(inbox.connected()).toEqual([]);
  db.close();
});
