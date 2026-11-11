import type Database from "better-sqlite3";
import { Redactor } from "../../security/src/redaction.ts";
import {
  backlog,
  deliveredUpdate,
  startedUpdate,
  ticketBranch,
  ticketBrief,
  ticketProviders,
  type Ticket,
  type TicketAdapter,
  type TicketFilter,
  type TicketProvider,
  type TicketStatus,
  type TicketUpdate,
} from "../../domain/src/tickets.ts";

interface Row {
  provider: TicketProvider;
  external_id: string;
  title: string;
  body: string;
  url: string;
  status: TicketStatus;
  priority: number;
  assignee: string | null;
  project: string | null;
  labels_json: string;
  detail_json: string;
  branch: string | null;
  session_id: string | null;
}

function toTicket(row: Row): Ticket {
  return {
    provider: row.provider,
    externalId: row.external_id,
    title: row.title,
    body: row.body,
    url: row.url,
    status: row.status,
    priority: row.priority,
    assignee: row.assignee,
    project: row.project,
    labels: JSON.parse(row.labels_json) as string[],
    ...(JSON.parse(row.detail_json) as Pick<
      Ticket,
      "reproduction" | "attachments" | "comments"
    >),
  };
}

/**
 * A local copy of the tickets the signed-in user can see, from whichever
 * trackers have an adapter. Writes back to a tracker are returned as
 * proposals for the existing approval path; nothing is sent from here.
 */
export class TicketInbox {
  private readonly db: Database.Database;
  private readonly redactor: Redactor;
  private readonly adapters = new Map<TicketProvider, TicketAdapter>();
  constructor(db: Database.Database, redactor: Redactor = new Redactor()) {
    this.db = db;
    this.redactor = redactor;
  }

  /** Makes one tracker available. A second adapter for it is refused. */
  connect(adapter: TicketAdapter): () => void {
    if (!ticketProviders.includes(adapter.provider))
      throw Error("Unsupported ticket provider");
    if (this.adapters.has(adapter.provider))
      throw Error("That tracker is already connected");
    this.adapters.set(adapter.provider, adapter);
    return () => {
      if (this.adapters.get(adapter.provider) === adapter)
        this.adapters.delete(adapter.provider);
    };
  }

  connected(): TicketProvider[] {
    return [...this.adapters.keys()].sort();
  }

  /**
   * Refreshes every connected tracker. One tracker failing does not stop
   * the others; its earlier tickets are kept and the failure is reported.
   */
  async sync(productId?: string): Promise<{
    fetched: Partial<Record<TicketProvider, number>>;
    failed: TicketProvider[];
  }> {
    const fetched: Partial<Record<TicketProvider, number>> = {};
    const failed: TicketProvider[] = [];
    for (const [provider, adapter] of this.adapters) {
      let tickets: Ticket[];
      try {
        tickets = await adapter.list();
      } catch {
        failed.push(provider);
        continue;
      }
      const valid = tickets.filter(
        (t) =>
          t.provider === provider &&
          t.externalId.trim() &&
          /^https:\/\//.test(t.url),
      );
      this.db.transaction(() => {
        // A ticket the user can no longer see is removed, unless work started on it.
        const keep = new Set(valid.map((t) => t.externalId));
        for (const row of this.db
          .prepare("SELECT external_id,branch FROM tickets WHERE provider=?")
          .all(provider) as { external_id: string; branch: string | null }[])
          if (!keep.has(row.external_id) && row.branch === null)
            this.db
              .prepare("DELETE FROM tickets WHERE provider=? AND external_id=?")
              .run(provider, row.external_id);
        for (const ticket of valid) this.upsert(ticket, productId);
      })();
      fetched[provider] = valid.length;
    }
    return { fetched, failed: failed.sort() };
  }

  list(filter: TicketFilter = {}): Ticket[] {
    return backlog(
      (this.db.prepare("SELECT * FROM tickets").all() as Row[]).map(toTicket),
      filter,
    );
  }

  get(provider: TicketProvider, externalId: string): Ticket {
    return toTicket(this.row(provider, externalId));
  }

  /**
   * Prepares work on a ticket: a branch name, the agent's brief and the
   * proposed status change. Starting twice returns the same branch.
   */
  begin(
    provider: TicketProvider,
    externalId: string,
    sessionId?: string,
  ): {
    branch: string;
    brief: string;
    update: TicketUpdate;
    alreadyStarted: boolean;
  } {
    const row = this.row(provider, externalId);
    const ticket = toTicket(row);
    if (ticket.status === "done" || ticket.status === "closed")
      throw Error("This ticket is already closed in its tracker");
    const branch = row.branch ?? ticketBranch(ticket);
    if (!row.branch)
      this.db
        .prepare(
          "UPDATE tickets SET branch=?,session_id=?,started_at=? WHERE provider=? AND external_id=?",
        )
        .run(
          branch,
          sessionId ?? null,
          new Date().toISOString(),
          provider,
          externalId,
        );
    return {
      branch,
      brief: ticketBrief(ticket),
      update: startedUpdate(ticket),
      alreadyStarted: row.branch !== null,
    };
  }

  /** The ticket a branch or session came from, for tracing work to its source. */
  origin(ref: { branch: string } | { sessionId: string }): Ticket | null {
    const row = (
      "branch" in ref
        ? this.db
            .prepare("SELECT * FROM tickets WHERE branch=?")
            .get(ref.branch)
        : this.db
            .prepare("SELECT * FROM tickets WHERE session_id=?")
            .get(ref.sessionId)
    ) as Row | undefined;
    return row ? toTicket(row) : null;
  }

  /** The proposed comment for the tracker once a pull request exists. */
  delivered(
    provider: TicketProvider,
    externalId: string,
    result: { pullRequestUrl: string; summary: string; notes?: string },
  ): TicketUpdate {
    if (!/^https:\/\//.test(result.pullRequestUrl))
      throw Error("Give the pull request's https link");
    if (!this.row(provider, externalId).branch)
      throw Error("Work has not started on this ticket");
    const update = deliveredUpdate(this.get(provider, externalId), result);
    return { ...update, comment: this.redactor.text(update.comment ?? "") };
  }

  private row(provider: TicketProvider, externalId: string): Row {
    const row = this.db
      .prepare("SELECT * FROM tickets WHERE provider=? AND external_id=?")
      .get(provider, externalId) as Row | undefined;
    if (!row) throw Error("Unknown ticket");
    return row;
  }

  private upsert(ticket: Ticket, productId?: string): void {
    const priority = Number.isInteger(ticket.priority)
      ? Math.max(1, Math.min(5, ticket.priority))
      : 3;
    this.db
      .prepare(
        `INSERT INTO tickets(provider,external_id,product_id,title,body,url,status,priority,assignee,project,labels_json,detail_json,fetched_at)
         VALUES (@provider,@id,@product,@title,@body,@url,@status,@priority,@assignee,@project,@labels,@detail,@at)
         ON CONFLICT(provider,external_id) DO UPDATE SET title=@title,body=@body,url=@url,status=@status,priority=@priority,
           assignee=@assignee,project=@project,labels_json=@labels,detail_json=@detail,fetched_at=@at`,
      )
      .run({
        provider: ticket.provider,
        id: ticket.externalId,
        product: productId ?? null,
        title: this.redactor.text(ticket.title).slice(0, 500),
        body: this.redactor.text(ticket.body).slice(0, 50000),
        url: ticket.url,
        status: ticket.status,
        priority,
        assignee: ticket.assignee,
        project: ticket.project,
        labels: JSON.stringify([...ticket.labels].slice(0, 50)),
        detail: JSON.stringify(
          this.redactor.clean({
            ...(ticket.reproduction
              ? { reproduction: ticket.reproduction }
              : {}),
            ...(ticket.attachments ? { attachments: ticket.attachments } : {}),
            ...(ticket.comments ? { comments: ticket.comments } : {}),
          }),
        ),
        at: new Date().toISOString(),
      });
  }
}
