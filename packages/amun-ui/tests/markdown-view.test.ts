import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseInline,
  parseMarkdown,
  tableSnippet,
  toggleTask,
} from "../src/rebuild/markdown-view.ts";
import { MarkdownMessage } from "../src/rebuild/markdown-doc.tsx";
import { OutputDoc } from "../src/rebuild/work-session.tsx";

const PRD = `# PRD v1 (R1 only): Self-service team invitations, QA-20261115-Invites

**SYNTHETIC QA DATA. Local draft only. Not published to Azure DevOps or Notion. No backlog, sprint or estimate is proposed; those need separate approvals.**
**Sources:** "Amun_PRD.md" (id bc28df5a-c188-4296-971f-7d0f82c89ffe); "QA-20261115-Invites: understanding of the product (with SendGrid correction)" (id 15331258-1e41-444d-93e9-f28f6a5c3930); "Interview note: admins say invitations expire too fast" (id b8926a6e-8067-431e-b7c0-50ea3a6f39cb).

## Problem and users
- **Enterprise workspace admins** must invite teammates today through a support ticket; they need to do it themselves.
- **Invitees** need a clear path to join the correct workspace.

## Objective and proposed success measure
- Objective: reduce the time for a new enterprise team to get its first teammate working.
- **Proposed target (not a result):** 80% of new teams onboard without support. Baseline and current performance are unknown; nothing has been measured and no improvement is claimed. "Onboard without support" has no agreed definition or measurement method yet (open question).

## R1 requirements (as in Amun_PRD.md)
| ID | Requirement |
|---|---|
| REQ-01 | An authorized admin can invite one teammate by email. Validate the email and prevent an active duplicate invitation. |
| REQ-02 | Admin selects Member or Admin role. The safe default is Member. |
| REQ-03 | An invitee can accept a valid invitation and join only its intended workspace. |
| REQ-04 | Admin sees pending invitations and can resend or revoke one. |
| REQ-05 | Expired and revoked invitation links show clear recovery copy and do not grant membership. |

## Acceptance criteria
- Each requirement (REQ-01 to REQ-05) is traceable to at least one user story (stories to be written; none exist in the sources).
- In the invitation form, the role picker is preselected to Member; Admin is selectable only as a deliberate choice by the admin. (REQ-02)
- Only authorized admins can create, resend, revoke or view invitations.
- Test coverage includes invalid email, expired, revoked and duplicate invitations.
- Detailed pass/fail wording per requirement is TBC with the team; none is given in the sources.

## Out of scope
- Bulk invitations (R2).
- SSO provisioning.
- Domain-wide automatic enrollment.

## Assumptions
- **Seven-day invitation expiry is an assumption awaiting security review, not policy;** the duration may change.
- Email delivery provider is **SendGrid**, per the owner's correction (QA test value). The source PRD still lists the provider as unresolved, so this is attributed to the owner, not the PRD.

## Risks
- Expiry and resend limits unconfirmed by security; the design may change.
- Undefined existing-user behavior could affect REQ-03 (acceptance) and duplicate prevention in REQ-01.
- No baseline, so the 80% target cannot be judged until a measurement approach exists.
- Audit, delivery estimates and accessibility are unresolved, so scope and timing are unknown.

## Open questions
1. Security: confirm expiry duration and resend limits.
2. Existing-user behavior: what happens when the invitee already has an account?
3. Audit requirements for invitation actions.
4. Delivery estimates (none given).
5. Accessibility review.
6. How is "onboard without support" defined and measured, given no baseline?
7. Expiry input: an interview note reports that admins complain invitations expire too fast. It is a one-line summary with no interviewee, date, quote, count or definition of "too fast". It is **unquantified input to question 1, not evidence**, and does not change the seven-day assumption.

## Approvals still needed
Backlog publication and sprint commitment each require separate approval; none is requested here.

---
**Change note:** the added acceptance criterion (role picker preselected to Member) is traceable to REQ-02 and matches Screen 1 of the wireframe (document delegation-7bd6dcd9-df9e-40b5-a868-c8109a127490). Nothing else was changed.`;

describe("markdown view parser", () => {
  it("parses headings, rules and inline marks", () => {
    expect(parseMarkdown("# A\n## B\n### C\n---")).toEqual([
      { kind: "heading", level: 1, content: [{ kind: "text", text: "A" }] },
      { kind: "heading", level: 2, content: [{ kind: "text", text: "B" }] },
      { kind: "heading", level: 3, content: [{ kind: "text", text: "C" }] },
      { kind: "rule" },
    ]);
    expect(parseInline("a **b `c`** `d`")).toEqual([
      { kind: "text", text: "a " },
      {
        kind: "bold",
        children: [
          { kind: "text", text: "b " },
          { kind: "code", text: "c" },
        ],
      },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
    ]);
  });

  it("parses bullet, numbered and task lists", () => {
    const [bullets, numbers, tasks] = parseMarkdown(
      "- a\n- b\n\n1. x\n2. y\n\n- [ ] open\n- [x] done",
    );
    expect(bullets).toMatchObject({ kind: "list", ordered: false });
    expect(numbers).toMatchObject({ kind: "list", ordered: true });
    expect(tasks).toMatchObject({
      kind: "list",
      items: [
        { task: { checked: false, line: 6, label: "open" } },
        { task: { checked: true, line: 7, label: "done" } },
      ],
    });
  });

  it("parses pipe tables and joins paragraph lines", () => {
    const blocks = parseMarkdown("one\ntwo\n\n| A | B |\n|---|---|\n| 1 | 2 |");
    expect(blocks[0]).toMatchObject({ kind: "paragraph" });
    expect((blocks[0] as { lines: unknown[] }).lines).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      kind: "table",
      header: [[{ text: "A" }], [{ text: "B" }]],
    });
    expect((blocks[1] as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("does not loop on a hash with no space", () => {
    expect(parseMarkdown("#tag")).toMatchObject([{ kind: "paragraph" }]);
  });

  it("parses the PRD sample", () => {
    const blocks = parseMarkdown(PRD);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(
      blocks.filter((b) => b.kind === "heading" && b.level === 2),
    ).toHaveLength(9);
    const tables = blocks.filter((b) => b.kind === "table");
    expect(tables).toHaveLength(1);
    expect((tables[0] as { header: unknown[] }).header).toHaveLength(2);
    expect((tables[0] as { rows: unknown[] }).rows).toHaveLength(5);
    const numbered = blocks.filter((b) => b.kind === "list" && b.ordered);
    expect(numbered).toHaveLength(1);
    expect((numbered[0] as { items: unknown[] }).items).toHaveLength(7);
    expect(blocks.filter((b) => b.kind === "rule")).toHaveLength(1);
    expect(blocks.some((b) => b.kind === "list" && !b.ordered)).toBe(true);
  });

  it("keeps markup-looking text as text", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([
      { kind: "text", text: "<script>alert(1)</script>" },
    ]);
  });

  it("toggles only the target task line", () => {
    const body = "- [ ] a\n- [x] b\ntext [ ]\n- [ ] c";
    expect(toggleTask(body, 0)).toBe("- [x] a\n- [x] b\ntext [ ]\n- [ ] c");
    expect(toggleTask(body, 1)).toBe("- [ ] a\n- [ ] b\ntext [ ]\n- [ ] c");
    expect(toggleTask(body, 3)).toBe("- [ ] a\n- [x] b\ntext [ ]\n- [x] c");
    expect(toggleTask(body, 9)).toBe(body);
  });

  it("starts the table snippet with a blank line after text", () => {
    expect(tableSnippet("text").startsWith("\n\n| Column")).toBe(true);
    expect(tableSnippet("text\n").startsWith("\n| Column")).toBe(true);
    expect(tableSnippet("text\n\n").startsWith("| Column")).toBe(true);
    expect(tableSnippet("").startsWith("| Column")).toBe(true);
  });
});

describe("document pane", () => {
  const snapshot = {
    library: [
      {
        id: "o1",
        groupId: "g",
        type: "doc",
        title: "Doc",
        body: "# Hi\n\n| A | B |\n|---|---|\n| 1 | <b>2</b> |\n\n- [x] done",
        status: "draft",
        workAreaIds: ["a1"],
        section: "work",
        needsLinking: false,
      },
    ],
  };
  const render = (editing: boolean) =>
    renderToStaticMarkup(
      createElement(OutputDoc, {
        snapshot: snapshot as never,
        areaId: "a1",
        outputId: "o1",
        editing,
        onAsk: () => {},
      }),
    );

  it("shows a formatted table in Viewing and the textarea in Editing", () => {
    const viewing = render(false);
    expect(viewing).toContain("<table>");
    expect(viewing).toContain("&lt;b&gt;2&lt;/b&gt;");
    expect(viewing).toContain('aria-label="done"');
    expect(viewing).not.toContain("<textarea");
    const editing = render(true);
    expect(editing).toContain("<textarea");
    expect(editing).not.toContain("<table>");
  });
});

describe("Firstmate reply markdown", () => {
  const render = (text: string, onLink?: (url: string) => void) =>
    renderToStaticMarkup(
      createElement(MarkdownMessage, onLink ? { text, onLink } : { text }),
    );

  it("renders formatting but escapes raw HTML", () => {
    const html = render(
      "- **Client:** QA *Test* Client\n\n<script>alert(1)</script> <img src=x onerror=y>",
    );
    expect(html).toContain("<strong>Client:</strong>");
    expect(html).toContain("<em>Test</em>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("only links web addresses, through the supplied handler", () => {
    expect(parseInline("[x](javascript:alert)")).toEqual([
      { kind: "text", text: "x" },
    ]);
    expect(parseInline("[x](file:///etc/passwd)")).toEqual([
      { kind: "text", text: "x" },
    ]);
    expect(parseInline("[x](https://example.com/a)")).toMatchObject([
      { kind: "link", url: "https://example.com/a" },
    ]);
    const open = () => undefined;
    expect(render("[docs](https://example.com)", open)).toContain("<button");
    const plain = render("[docs](https://example.com)");
    expect(plain).not.toContain("<button");
    expect(plain).not.toContain("<a ");
    expect(plain).toContain("docs");
  });

  it("shows checklists as static marks and fenced code as text", () => {
    const html = render("- [x] done\n- [ ] todo\n\n```\n<b>x</b>\n```");
    expect(html).not.toContain("<input");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
