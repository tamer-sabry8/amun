import type Database from "better-sqlite3";
import {
  prCommand,
  prResult,
  prDetail,
} from "../../../packages/contracts/src/pr-workspace.ts";
import { DeliveryReview } from "../../../packages/data/src/pr-delivery.ts";
import { repositoryTarget, type PullAdapter } from "./pr-repositories.ts";
import { azurePulls } from "./azure-pulls.ts";
type Source = { id: string; kind: string; reference: string | null };
export async function readPullWorkspace(
  input: unknown,
  db: Database.Database,
  sources: Source[],
  current: () => string | null,
  credential: (provider: "ado" | "github", origin: string) => string,
) {
  const cmd = prCommand.parse(input),
    meta = { kind: "pr-result", id: cmd.id, product: cmd.product };
  const check = () => {
    if (current() !== cmd.product) throw Error("Product changed.");
  };
  check();
  const available = sources.filter((s) => s.kind === "repo" && s.reference);
  const connect = async (s: Source) => {
    const t = repositoryTarget(s.reference!);
    const github =
      t.provider === "GitHub" ? await import("./github-pulls.ts") : undefined;
    check();
    const adapter: PullAdapter =
      t.provider === "GitHub"
        ? github!.githubPulls(
            t.origin,
            t.owner,
            t.repo,
            credential("github", t.origin),
          )
        : azurePulls(
            t.collection,
            t.project,
            t.repo,
            credential("ado", t.collection),
          );
    return { t, adapter };
  };
  if (cmd.action === "list") {
    const rows = [];
    let unavailable = 0;
    for (const source of available) {
      try {
        const { t, adapter } = await connect(source);
        for (const row of await adapter.list())
          rows.push({ ...row, source: source.id, provider: t.provider });
      } catch {
        unavailable++;
      }
    }
    return prResult.parse({
      ...meta,
      rows,
      message: unavailable
        ? unavailable +
          " mapped repositories unavailable. Check their connections."
        : rows.length + " open pull requests.",
    });
  }
  const source = available.find((s) => s.id === cmd.source);
  if (!source) throw Error("Map this repository to the current product.");
  const { adapter, t } = await connect(source),
    n = cmd.number,
    read = async () => prDetail.parse(await adapter.details(n));
  const service = new DeliveryReview(db);
  const latest = () => {
    const row = db
      .prepare(
        "SELECT id,payload_hash AS binding,target_revisions_json AS rev,state,payload_json AS payload FROM actions WHERE kind='merge' AND product_id=? AND json_extract(payload_json,'$.number')=? AND json_extract(payload_json,'$.repo')=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(cmd.product, n, t.url) as
      | {
          id: string;
          binding: string;
          rev: string;
          state: string;
          payload: string;
        }
      | undefined;
    if (!row) return {};
    const payload = JSON.parse(row.payload);
    return {
      review: {
        id: row.id,
        binding: row.binding,
        head: JSON.parse(row.rev).head,
        base: payload.base,
        method: payload.method,
        state: row.state,
        stories: service.stories(
          cmd.product,
          t.url,
          n,
          JSON.parse(row.rev).head,
        ),
        decisions: service.decisions(row.id),
      },
    };
  };
  if (cmd.action === "details")
    return prResult.parse({
      ...meta,
      detail: await read(),
      ...latest(),
      message: "Pull request loaded.",
    });
  if (cmd.action === "file")
    return prResult.parse({
      ...meta,
      diff: await adapter.diff(n, cmd.path, cmd.head),
      message: "Diff loaded.",
    });
  if (cmd.action === "review") {
    const r = await read();
    check();
    if (r.head !== cmd.head || !r.votes.includes(cmd.vote))
      throw Error("Refresh the pull request before reviewing.");
    await adapter.review(n, cmd.head, cmd.vote, cmd.body);
    return prResult.parse({
      ...meta,
      detail: await read(),
      ...latest(),
      message: "Review submitted.",
    });
  }
  if (cmd.action === "prepare") {
    const r = await read();
    check();
    if (r.head !== cmd.head)
      throw Error("PR head changed. Refresh before preparing a merge.");
    service.prepare(
      {
        product: cmd.product,
        repo: t.url,
        number: n,
        method: cmd.method,
        base: r.base,
      },
      r,
    );
    return prResult.parse({
      ...meta,
      ...latest(),
      message: "Review the repository, PR, head, base and merge method.",
    });
  }
  const target = {
    product: cmd.product,
    repo: t.url,
    number: n,
    method: cmd.method,
    base: cmd.base,
  };
  if (cmd.action === "approve") {
    const current = await read();
    check();
    service.approve(target, cmd.reviewId, cmd.binding, current);
  } else if (cmd.action === "execute")
    await service.execute(
      target,
      cmd.reviewId,
      cmd.binding,
      read,
      async (head) => {
        check();
        await adapter.merge(n, head, cmd.method);
      },
    );
  else if (cmd.action === "accept") {
    const state = await read();
    check();
    if (!state.merged) throw Error("Merge verification is required.");
    service.accept(
      target,
      state,
      cmd.reviewId,
      cmd.binding,
      cmd.story,
      cmd.verdict,
      cmd.rationale,
      cmd.checks,
    );
  }
  return prResult.parse({
    ...meta,
    ...latest(),
    detail: await read(),
    message:
      cmd.action === "approve"
        ? "Merge approved."
        : cmd.action === "execute"
          ? "Merge verified."
          : "Acceptance recorded.",
  });
}
