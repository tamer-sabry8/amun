import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  changeSummary,
  checksLabel,
  mergeStage,
  resultMessage,
} from "../src/rebuild/pull-requests-model.ts";
import { PullRequests } from "../src/rebuild/pull-requests.tsx";
import { parseAmunActions } from "../src/rebuild/view-model.ts";

const head = "a".repeat(40);
const moved = "b".repeat(40);

describe("pull request list wording", () => {
  it("summarises checks and the size of the change", () => {
    expect(checksLabel("passing").text).toBe("Checks passing");
    expect(checksLabel("failing").tone).toBe("bad");
    expect(checksLabel(undefined).text).toBe("No checks");
    expect(changeSummary({ files: 3, additions: 20, deletions: 4 })).toBe(
      "3 files · +20 −4",
    );
    expect(changeSummary({ files: 1, additions: 1, deletions: 0 })).toBe(
      "1 file · +1 −0",
    );
    expect(changeSummary({})).toBe("");
  });
});

describe("merge plan stage", () => {
  const live = { head, merged: false };
  it("walks plan, approval, merge and keeps merging apart from acceptance", () => {
    expect(mergeStage(undefined, live)).toBe("none");
    expect(mergeStage({ head, state: "pending_approval" }, live)).toBe(
      "approve",
    );
    expect(mergeStage({ head, state: "approved" }, live)).toBe("merge");
    expect(mergeStage({ head, state: "unknown" }, live)).toBe("verify");
    expect(
      mergeStage({ head, state: "succeeded" }, { head, merged: true }),
    ).toBe("merged");
  });
  it("blocks a plan whose version moved on or was invalidated", () => {
    expect(
      mergeStage({ head, state: "approved" }, { head: moved, merged: false }),
    ).toBe("stale");
    expect(mergeStage({ head: moved, state: "pending_approval" }, live)).toBe(
      "stale",
    );
    expect(mergeStage({ head, state: "invalidated" }, live)).toBe("stale");
  });
  it("says plainly that a changed pull request was not merged", () => {
    expect(
      resultMessage(
        "execute",
        false,
        "The PR head or base changed. Review the new version.",
      ),
    ).toMatch(/Nothing was merged/);
    expect(resultMessage("list", true, "", 0)).toBe("No open pull requests.");
  });
});

describe("connecting a repository through Firstmate", () => {
  const block = (value: unknown) =>
    "```amun\n" + JSON.stringify(value) + "\n```";
  it("accepts only a plain https address", () => {
    expect(
      parseAmunActions(block({ do: "repo", url: "https://github.com/o/r/" }))
        .actions,
    ).toEqual([{ do: "repo", url: "https://github.com/o/r" }]);
    for (const url of [
      "http://github.com/o/r",
      "https://key@github.com/o/r",
      "https://github.com/o/r?token=x",
      "not a url",
    ])
      expect(parseAmunActions(block({ do: "repo", url })).actions).toEqual([]);
  });
  it("shows how to connect one when the project has none", () => {
    const html = renderToStaticMarkup(
      createElement(PullRequests, {
        context: { productId: "p", sources: [] } as never,
        onAsk: () => undefined,
      }),
    );
    expect(html).toContain("No repository is connected to this project yet.");
    expect(html).not.toMatch(/terminal/i);
  });
});
