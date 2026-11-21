import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  findPrdReport,
  isPrdRelayReply,
  prdRelayPrompt,
} from "./prd-report-relay.js";

it("relays a completed PRD report only for the request in its delivered dispatch record", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "amun-prd-relay-"));
  try {
    const state = path.join(home, "state");
    const status = path.join(state, "prd.status");
    const pending = path.join(state, "pending-replies");
    await mkdir(pending, { recursive: true });
    const ref = "amun-r-a123456789ab";
    const other = "amun-r-b123456789ab";
    const corr = "0123456789abcdef";
    const epoch = Math.floor(Date.now() / 1000);
    const report = `done [at=${epoch}]: corr=${corr} ${ref} Read all 504 lines.`;
    const requests = [
      { ref, status: "working", updatedAt: new Date().toISOString() },
    ];
    const writeDispatch = (request: string) =>
      writeFile(
        path.join(pending, corr),
        [
          "schema=fm-pending-reply.v1",
          `corr_id=${corr}`,
          "task_id=prd",
          `parent_status=${status}`,
          `request_summary=${request}`,
          `delivered_epoch=${epoch}`,
        ].join("\n"),
      );
    await writeFile(status, report + "\n");
    await writeDispatch(other);
    expect(await findPrdReport(home, requests, new Set())).toBeNull();
    await writeDispatch(ref);
    expect(await findPrdReport(home, requests, new Set([ref]))).toBeNull();
    const found = await findPrdReport(home, requests, new Set());
    expect(found).toEqual({ ref, text: `${ref} Read all 504 lines.` });
    expect(prdRelayPrompt(found!)).toContain("Read all 504 lines.");
    expect(isPrdRelayReply("A report without a reference.", ref)).toBe(false);
    expect(
      isPrdRelayReply(
        "Read completed.\n" +
          "```amun\n" +
          JSON.stringify({ do: "report", request: ref, status: "delivered" }) +
          "\n```",
        ref,
      ),
    ).toBe(true);
    await writeFile(status, report);
    expect(await findPrdReport(home, requests, new Set())).toBeNull();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
