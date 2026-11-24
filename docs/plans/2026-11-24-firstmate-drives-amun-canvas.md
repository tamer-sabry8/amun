# FINAL PLAN: Firstmate drives, Amun shows

**Document status:** final execution brief, version 5, 24 November 2026. It supersedes v1–v4 and both external LLM plans.
**Audience:** the coding agent that will execute it.
**Owner:** Tamer (the captain).

---

## READ THIS FIRST: orders to the executing agent

1. **Execute the phases in order (0 → 8).** Within a phase, do the tasks in order. Do not start a phase until the previous phase's success metrics are met and recorded. The exceptions are listed under "Blocked work" (§3.4).
2. **Do not improvise scope.** If something is not written here, do not build it. If this plan and the code disagree, stop that task, record the exact mismatch (file, line, what you expected, what you found), and continue with the next independent task.
3. **Do not change any visible UI** (text, labels, buttons, layout, click behaviour) until Phase 7 approval is recorded. Phases 2–6 are written so they change nothing the owner can see.
4. **Never edit:**
   - `vendor/firstmate/`;
   - any file in a Firstmate home;
   - the owner's personal Firstmate at `/Users/tamersabry/Projects/firstmate`;
   - any other git worktree;
   - migrations (`packages/work-store/src/migrations.ts`).
5. **Never push, open a PR or merge** without the owner's explicit word in chat.
6. **Report with evidence.** Every claim in your report needs a command output, test name, file:line, trace line or screenshot path. "Should work" is not evidence.
7. **Line numbers are from `main` at `8f77595`.** If `origin/main` has moved, find the same symbol by name (each reference names its function or string). Record the new line in your report.

---

## 0. Why this plan exists (context)

The owner decided that **Firstmate is the brain and Amun is the canvas**.

- **Firstmate** (the Pi agent in the owner's Firstmate home) decides what to do, delegates to its crew, and tells Amun what to show.
- **Amun** owns:
  - a fixed set of screens;
  - a Markdown document viewer;
  - approvals;
  - credentials;
  - publishing;
  - the record of which chat and request every result belongs to.
- PM method lives in Firstmate's own Markdown files, not in Amun code.
- Amun code changes are kept to the minimum.

Research across Google A2UI, AG-UI, CopilotKit, MCP Apps, OpenAI Apps SDK, Vercel AI SDK and json-render, plus practitioner writing, agrees on one shape:

- the **app owns a fixed set of components**;
- the **agent picks one and passes data or pointers**;
- **clicks return as structured actions**;
- **lasting state lives outside the chat**;
- **the layout stays stable**.

The research references are in §9.

**Amun already has this shape.**

- Firstmate ends its replies with fenced ` ```amun ` JSON blocks.
- Amun validates 26 action types (`packages/amun-ui/src/rebuild/view-model.ts:292-357`, parser `:368-633`).
- Amun renders Markdown documents as React elements with no raw HTML (`packages/amun-ui/src/rebuild/markdown-doc.tsx:140-215`).

This plan closes **five proven gaps**:

| Gap | Fact |
|---|---|
| G1 | The screen catalogue Firstmate is taught (`amunProtocol`, `view-model.ts:891-928`) is a TypeScript string, so changing it needs code. |
| G2 | Replies that arrive later (crew results) honour only `report`, `reassigned`, `plan` and `document` blocks (`packages/domain/src/work/requests.ts:134-205`). A `show` block is dropped, so Firstmate cannot point the captain at a new result. |
| G3 | Library documents do not record their chat (`library_outputs`, `packages/work-store/src/migrations.ts:897-906`). Clicking a document cannot bring back the conversation it came from. |
| G4 | The document "Open preview" button sends `output-preview` (`work-session.tsx:1144`), but nothing handles it. The handler was added in `25f11fe` (15 Nov) and deleted in `4ae3c77` (18 Nov). |
| G5 | The PM method (RFP → proposal → BRD → PRD, RICE, MoSCoW, roadmap, plan, executive pulse) is not in Firstmate. Only the PRD crewmate's files are collected automatically (`packages/server/src/server/amun/attach-amun.ts:523-643`). |

---

## 1. Facts this plan relies on (all verified by the planner on 24 Nov 2026)

| # | Fact | Evidence |
|---|---|---|
| F1 | A ` ```amun ` block is parsed by `parseAmunActions` (max 12 per reply) for replies to the captain's own messages. The renderer then dispatches it in `raise()`. | `view-model.ts:618-633`; `work-session.tsx:1598-2010, 2082, 2147` |
| F2 | Every reply with ` ```amun ` is also sent to the store's `apply-reply`. The prompted path does **not** set `raisePlans`; the late (unprompted) path **does**. | prompted: `work-session.tsx:2136-2142`; late: `packages/work-store/src/first-mate-thread.ts:93-108` |
| F3 | `apply-reply` files `document` blocks. It links a document to a work area **only if** the block's `request` reference is known (`workAreaIds: owner ? [owner] : []`). It writes a `delivered` card `{kind,outputId,title,version,request}` in the request's chat. | `work-store.ts:3502-3574` |
| F4 | **Version history:** a document becomes version 2 only if the **same request** (or, without a request, the same chat) delivers the **same title**. A new request with the same title makes a **new** document. | `work-store.ts:3512-3546` |
| F5 | A request sent from a folder chat records that folder as its project. A request sent from General records no project. | `work-session.tsx:2359-2366` |
| F6 | **Size limits on the filing path:** `apply-reply.text` ≤ 200,000 characters (`packages/contracts/src/work.ts:1260-1262`). If a reply is larger, the command fails validation in `handle()` (`work-store.ts:973-974`) and the documents in it are **lost silently**. The daemon relay skips anything over `APPLY_REPLY_LIMIT = 200_000` (`attach-amun.ts:58`). The renderer's 90,000-character slice (`view-model.ts:380`) applies only to the renderer copy of a `document` action, which is ignored (`work-session.tsx:1601`). The 100,000-character `longText` cap (`contracts/src/work.ts:9`) is checked only for commands from the UI, not for documents filed inside `apply-reply`. | as cited |
| F7 | `show` today: views `stories`, `receipt`, `sprints`, `requirements`, `release`, `activity`. It opens beside the chat through `openView` and writes an `opened-view` card rendered as "Opened · <label>". | parser `view-model.ts:579-598`; type `:338-348`; `openView` `work-session.tsx:1533-1596`; handler `:1918-1932`; card renderer `:32-61, 3367-3392` |
| F8 | `workAsync` resolves only after the snapshot that follows the command has arrived in the store (`packages/amun-ui/src/rebuild/store.ts:106-150`). `latest.current` in `work-session.tsx:2503-2504` is updated only on React render, so it may be stale right after an `await`. | as cited |
| F9 | Pane kinds include `output` (a document) and `backlog`. | `work-session.tsx:228-248` |
| F10 | `shellReducer` `go` clears the work area and closes the side panel, which leaves the chat. | `packages/domain/src/work/shell.ts:84-94` |
| F11 | Chats: the first chat of a work area has no row (`chat_id` NULL). Ordinary chats are `work_chats.kind='chat'` with `forked_from=''`. Forks are `kind='fork'`. Forking copies messages, including cards, into the new chat. Chats can be archived (`archived_at`). | `migrations.ts:1123-1140`; `work-store.ts:2687-2740` |
| F12 | The Library snapshot item is a `z.strictObject` with no origin field. Unknown fields are rejected. | `contracts/src/work.ts:463-500`; built in `work-store.ts:541-590` |
| F13 | Clicking a Library item opens it in the current work area, or else its first linked area. If it has no linked area, it shows "Link this to a piece of work to open it beside its conversation." It never opens the originating chat. | `packages/amun-ui/src/rebuild/app.tsx:1027-1039`; `openWork(areaId, message?, target, chat, at)` at `:460-475` |
| F14 | Bridge messages from the window are dispatched by `kind` in `packages/amun-ui/src/daemon/contract-adapter.ts:912-1014`, which calls daemon RPC methods. Those methods are declared in `packages/protocol/src/amun-rpc.ts` (zod union, e.g. `:259, 268, 274`) and handled in `packages/server/src/server/amun/amun-rpc-handler.ts` (switch at `:362-630`). The handler reads the work store through `this.deps.work` (e.g. `:338, 496, 534`). | as cited |
| F15 | The deleted `output-preview` handler (in `4ae3c77~1:apps/desktop/src/service.ts`, lines 1764-1812, and `25f11fe:apps/desktop/src/prototype-preview.ts`, function `openHtmlPreview`) did the following: it read `type,body` from `library_outputs`; ran `previewSource()`; for a URL returned it; for HTML served it from a random 32-byte-hex path on `127.0.0.1:<random port>` with a strict CSP; kept at most 8 pages (closing the oldest); and closed all pages when the window port closed. | `git show 4ae3c77~1:apps/desktop/src/service.ts`; `git show 25f11fe:apps/desktop/src/prototype-preview.ts` |
| F16 | The deleted `prototype` handler (`PrototypeSession`, `4ae3c77~1:apps/desktop/src/prototype-session.ts`, 183 lines) delivered work to crew directly through tmux (`sendDelivery`). That bypasses Firstmate, which Amun rules 1, 2 and 8 now forbid. **It must not be restored as it was.** The `PrototypeCard` buttons (`prototype-card.tsx:40-75`, shown at `prd-view.tsx:511`) are dead today. | as cited |
| F17 | The browser pane accepts `https:` or `http:` on `localhost` / `127.0.0.1` / `[::1]` only. | `packages/desktop/src/features/amun-browser/browser-policy.ts:1-22` |
| F18 | **Proven by the planner:** a `.md?raw` import works in Vitest (temporary test passed), inlines as a string in `vite build` (vite 7.3.8), and needs a module declaration for `tsc` (error TS2307 without it, passes with it). Today only `declare module "*.css"` exists (`packages/amun-ui/src/styles.d.ts`). `tsconfig.json:19-27` includes `packages/amun-ui/**/*.ts`. Only `packages/amun-ui` imports `view-model.ts`. | planner probe, 24 Nov |
| F19 | Firstmate keeps captain rules in `data/captain.md` and `data/captain-shared.md`. Its skills are loaded on demand from `.agents/skills/*/SKILL.md`. Amun may not write its home. | `vendor/firstmate/AGENTS.md:68, 408, 414`; Amun rule 4; `firstmate-layer/PM_PLAYBOOK.md:3-6` |
| F20 | The Markdown viewer supports headings, lists, task lists (ticking saves the document: `work-session.tsx:1158-1166`), tables, code, links and local paths. It has no Mermaid, raw HTML, images or blockquotes. `[Title]` becomes a link only when exactly one Library item has that title. | `markdown-view.ts:1-22`; `markdown-doc.tsx:140-215`; `citations.ts:32, 57-60` |
| F21 | Library type labels: 14 exist. An unknown type shows its raw key. | `packages/amun-ui/src/rebuild/rail.tsx:28-43` |
| F22 | **Baseline on a fresh `npm ci` of `8f77595`:** `npm run typecheck:amun` passes. `npm test` **without** `npm run build:server` first fails 12 server test files with "Failed to resolve entry for package @amun/work-store" or "Cannot find package @getpaseo/protocol/amun-rpc". All 1,266 tests that load pass. After `npm run build:server`: **177 test files, 1,339 tests, all pass**, and `scripts/check-firstmate-pristine.sh` exits 0. | planner run, 24 Nov |

---

## 2. Rules that apply to every phase

The numbers count the bullets in `Amun_rules.md` in order.

- **Rule 1–2:** captain → Firstmate → crew. Amun never sends work to crew directly.
- **Rule 4:** Firstmate owns its home. Amun never writes it.
- **Rule 5:** test homes are Amun-owned git worktrees.
- **Rule 8:** Paseo hosts Pi and carries messages. It never spawns or messages crew.
- **Rule 9:** `vendor/firstmate/` stays pristine (`bash scripts/check-firstmate-pristine.sh` prints nothing).
- **Rule 15:** match results only by a confirmed `amun-r-[0-9a-f]{12}` reference. Never guess from wording or timing.
- **Rule 18:** any visible change needs an Impeccable before/after preview and the owner's approval. Nothing is added to the prompt box.
- **Rule 19:** navigation and `show` never authorise a write.
- **Rule 25:** never cross groups.
- **Rule 27:** separate branch and worktree; never reset other checkouts; never reopen PR #10.
- **Rule 28:** measure installed `Amun.app` bytes against 537,733,552.
- **Rule 29:** measure working set across all Amun processes against 500 MiB.
- **Also binding:**
  - `AGENTS.md` in the repo: Firstmate homes, isolation, approvals, UI approval rule, installed size;
  - the owner's `/Users/tamersabry/Documents/ChatGPT/Amun/releases/2026-11-24-AMUN-FIRSTMATE-FINAL-EXECUTION-PLAN.md`, called **"FEP"** below.

---

## 3. Phases

### Phase 0. Set up and finish the FEP

**Purpose:** a clean branch, a measured baseline, and the FEP's fixes landed. This plan builds on those fixes.

**Task 0.1. Create the worktree.**

```sh
git -C /Users/tamersabry/Projects/amun fetch origin
git -C /Users/tamersabry/Projects/amun rev-parse origin/main
git -C /Users/tamersabry/Projects/amun worktree add -b claude/firstmate-canvas /private/tmp/amun-firstmate-canvas origin/main
```

- Record the `origin/main` SHA.
- If it is not `8f77595`, run `git log --oneline 8f77595..origin/main` and record the commits. Re-find every symbol in this plan by name.

**Task 0.2. Install and build.**

```sh
cd /private/tmp/amun-firstmate-canvas
npm ci
npm run build:server
npm run typecheck:amun
npm run lint
npm run format:check
npm test
npm run test:server
bash scripts/check-firstmate-pristine.sh
```

- Use Node 24, or the root floor of 22.13 or later. Record `node --version`.
- `npm run build:server` **must** run before `npm test` (F22).
- Record pass and fail counts. Any failure here is a baseline failure. List it by file and keep it separate from anything you introduce later.

**Task 0.3. Build and measure the packaged baseline.**

```sh
npm run dist:mac:beta
```

- Output: `packages/desktop/release/mac-arm64/Amun.app` and the DMG.
- Launch the binary **by exact path**, never by bundle ID. A stale `~/Applications/Amun Firstmate Latency Test/…app` shares the bundle ID.
- Use isolated `PASEO_ELECTRON_USER_DATA_DIR`, `AMUN_HOME`, `PASEO_HOME` and `AMUN_FIRSTMATE_HOME` (an Amun-owned git worktree home), plus an unused loopback `PASEO_LISTEN`. Follow the isolated daemon pattern in `packages/desktop/e2e/packaged-app-smoke.js`.
- Confirm the listener and the effective paths before sending any prompt.
- Record:
  - startup time;
  - working set summed across all Amun processes at the first screen and at Home;
  - installed `Amun.app` bytes, measured the way Finder reports them.

**Task 0.4. Execute FEP Tasks 1, 2.1, 2.2, 2.3, 3.1 and 3.2 exactly as the FEP writes them.**

- Task 2.1 removes the false Copilot line, the array entry beginning `"Where you run: Amun routes you…"`, at `view-model.ts:917`.
- Do **not** run FEP Task 4 (trimming) now. It runs in Phase 5 of this plan.

**Watch out:**
- A disposable Electron profile alone does not isolate the daemon or Firstmate. All five environment variables are required.
- Beta builds must use `dist:mac:beta`. With hardened runtime on, an ad-hoc build crashes; `after-sign.js` enforces this.
- Never send policy text to the personal Firstmate.

**Phase 0 success metrics (all required):**
1. All FEP Task 2 and Task 3 regression tests listed in the FEP pass.
2. `typecheck:amun`, `lint`, `format:check`, `npm test`, `test:server` and the pristine check show **zero new failures** against the Task 0.2 baseline.
3. FEP acceptance rows "Browsing", "Timing and replay" and "Permissions" pass in the isolated packaged app, or are recorded as blocked with the exact missing credential.
4. Baseline numbers (startup, memory, installed bytes, SHA) are recorded before any Phase 2 code.

---

### Phase 1. Evidence trial (no code)

**Purpose:** measure what Firstmate does today, so Phases 2–6 are checked against real output.

**Task 1.1.** In the isolated packaged app and isolated Firstmate home from Phase 0, paste this **once** into a Product chat (e.g. "Badge Desk"):

> For this test, when I ask for one of these, delegate it to the right crewmate, then return the result as one Markdown document in an amun document block with my request reference and this type: proposal, brd, prd, idea, rice (table: Rank, Feature, Reach, Impact, Confidence, Effort, Score), moscow (task lists under Must, Should, Could, Won't), roadmap (a table per quarter: Feature, Pillar, Status), gantt (table: Phase, Start, End, Depends on, Gate), brief (per product: Health, On track, Risks, Decision needed; cite Library documents by exact title in square brackets).

**Task 1.2.** Send these as five separate messages:

| ID | Prompt |
|---|---|
| T1 | "Run RICE on the Badge Desk backlog." |
| T2 | "MoSCoW the Badge Desk first release." |
| T3 | "Build a 12-week phase plan from the Badge Desk PRD." |
| T4 | "Executive pulse on Badge Desk." |
| T5 | "Show the stories." |

**Task 1.3. Late-result test.** Ask: "Ask Research & Insights for a one-page competitor scan of Badge Desk as a research document." Immediately open a **different** Product and wait for the result.

**Task 1.4. Fill this table for T1–T5 and the late test.** Take the sources from `~/.amun/trace/<date>.jsonl` in the isolated `AMUN_HOME`, `work.db` (`sqlite3 -readonly`) and screenshots.

| Column | How to measure |
|---|---|
| a. Delegated to | The `corr=` report or Firstmate's reply |
| b. Block type | The `"type"` in the ` ```amun ` document block |
| c. Filed and linked | `select o.id,o.type,o.title,l.work_area_id from library_outputs o left join library_output_links l on l.output_id=o.id order by o.updated_at desc limit 10;` |
| d. Delivered card chat | The `work_messages` row with the `"delivered"` card for that `outputId` (`chat_id`) |
| e. Renders | Screenshot of the document pane |
| f. Repeat | Re-send T1. Record whether it made v2 or a new document. F4 predicts a new document. |
| g. Late `show` dropped | Record whether the late reply contained a ` ```amun ` show block and whether anything appeared |
| h. Reply size | Characters of the full reply, against 200,000 (F6) |

**Watch out:** do not edit any code in this phase. Do not paste anything into the personal Firstmate.

**Phase 1 success metrics:**
1. The table is complete for all six rows, with evidence for every cell.
2. Any reply over 150,000 characters is flagged, because F6 makes over 200,000 a silent loss.
3. Result f matches F4, or the mismatch is reported.

---

### Phase 2. The screen catalogue becomes Amun's own Markdown file (no visible change)

**Purpose:** close G1. Firstmate's instructions about Amun's screens live in one Markdown file inside Amun. The text Firstmate receives stays identical, except for the Phase 0 removal and the additions in Task 2.3.

**Task 2.1. Add the type declaration.** Append to `packages/amun-ui/src/styles.d.ts`:

```ts
declare module "*.md?raw" {
  const text: string;
  export default text;
}
```

**Task 2.2. Create the file.**
- Create `packages/amun-ui/src/rebuild/amun-canvas.md`.
- Copy every array entry of `amunProtocol` (`view-model.ts:891-928`, after Phase 0's Copilot-line removal) into it, **one entry per line, in the same order**.
- Replace the `${agentCatalog…}` interpolation inside the `delegate` entry (`view-model.ts:902`) with the literal token `{{AGENTS}}`. Copy the surrounding text exactly.
- First write down the exact JavaScript expression used at `:902`. Task 2.4 must reproduce it.

**Task 2.3. Edit two lines in `amun-canvas.md`.** Nothing else changes.

(a) The `document` line. Replace `"type":"prd|brd|research|update|doc"` with:

```
"type":"proposal|brd|prd|idea|rice|moscow|prototype|roadmap|gantt|brief|research|update|doc"
```

Then append this sentence to the same line:

> Shapes: rice is a table Rank | Feature | Reach | Impact | Confidence | Effort | Score sorted by Score; moscow is task lists under ## Must, ## Should, ## Could, ## Won't; roadmap is one table per quarter Feature | Pillar | Status; gantt is a table Phase | Start | End | Depends on | Gate; brief has per product Health, On track, Risks, Decision needed and cites Library documents by exact title in square brackets; prd starts with What, Why, When and Cost. Always include "request" with the Amun request reference so the document is linked to its work.

(b) Replace the whole `show` line with:

```
{"do":"show","view":"stories|receipt|sprints|requirements|release|activity|backlog|document","filter":"all|drafted|published|done","title":"…","request":"amun-r-…"} opens that screen of this work beside the conversation when the owner asks to see it ("show the stories", "open the RICE table", "where is the BRD?"). view "document" opens the Library document with exactly that title (this work first, then its group). filter applies to stories only. In a later reply that is not an answer to the owner's latest message, include "request" with the reference of the request it belongs to; Amun then leaves a one-click line in that request's chat instead of opening it. Answer in one line with what it shows and send this block; it changes nothing.
```

**Task 2.4. Load the file in `view-model.ts`.**
- Add `import canvas from "./amun-canvas.md?raw";`.
- Replace the `amunProtocol` array with:

  ```ts
  canvas.trim().replace("{{AGENTS}}", <the exact expression from :902>)
  ```

  The old array was joined with `"\n"`, so one entry per line, with the file's trailing newline trimmed, gives the same string.

- Keep the export name `amunProtocol` and its type (`string`). `work-session.tsx:206, 2448, 2495` use it unchanged.

**Task 2.5. Add a test.** Create `packages/amun-ui/tests/amun-canvas.test.ts`. It asserts:
1. `amunProtocol` contains no `{{AGENTS}}`.
2. It contains the name of every agent in `agentCatalog`.
3. It does not contain `"Where you run:"`.
4. It contains `"view \"document\""` and `"rice"`.
5. Its line count equals the number of lines in `amun-canvas.md`.

**Task 2.6. Run the checks.**
- `npm run typecheck:amun`, `npm run lint`, `npm run format:check`, `npm test`.
- `npm run build -w @amun/ui`, then confirm with `grep -c "open the RICE table" packages/amun-ui/build/renderer.js` (≥ 1).

**Watch out:**
- Do not move or copy `amun-canvas.md` anywhere near a Firstmate home (rule 4).
- Do not trim any other PM text yet (that is Phase 5).
- Prettier may reformat Markdown. If `format:check` touches `amun-canvas.md`, add it to `.prettierignore` so the text Firstmate receives cannot change by formatting.

**Phase 2 success metrics:**
1. All existing tests plus `amun-canvas.test.ts` pass, and typecheck, lint and format are clean.
2. The built renderer contains the new text.
3. A diff of the old and new protocol strings (print both in a test or script) shows **only** the two edits from Task 2.3 and the Phase 0 Copilot removal.
4. No visible UI change.

---

### Phase 3. `show` reaches documents, the backlog and late replies

**Purpose:** close G2 and deliver use case 14 ("where is the PRD for …").

**Task 3.1. Domain helpers.** In `packages/domain/src/work/requests.ts`:

(a) Export the type:

```ts
export type RequestShow = {
  request: string;
  view: "stories" | "receipt" | "sprints" | "requirements" | "release" | "activity" | "backlog" | "document";
  filter: "all" | "drafted" | "published" | "done";
  title: string | null;
};
```

(b) In `readRequestBlocks`:
- Add `shows: RequestShow[]` to the return type and the returned object (`:134-147` and `:204`).
- Inside the block loop, next to the `document` branch (`:190`), add:

  ```ts
  else if (value.do === "show" && isRequestRef(value.request) && SHOW_VIEWS.includes(value.view))
  ```

  It pushes `{request, view, filter, title}`:
  - `filter`: one of the four values, default `"all"`;
  - `title`: `clip(value.title, 200)` or `null`;
  - a `document` view with no title is **dropped**.
- Define `const SHOW_VIEWS` with the eight view names.

(c) Export `showLabel(view, filter, areaType, title)`. It returns:

| View | Label |
|---|---|
| `stories` | `"Stories"`, or `"Stories · Drafted|Published|Done"` (same rule as `work-session.tsx:1544-1549`) |
| `requirements` | `"BRD"` when `areaType === "project"`, else `"PRD"` |
| `sprints` | `"Sprints"` |
| `activity` | `"What happened"` |
| `receipt` | `"Receipt"` |
| `release` | `"Release"` |
| `backlog` | `"Backlog"` |
| `document` | `title` |

**Task 3.2. Parser.** In `view-model.ts`:
- Extend the `show` member of `AmunAction` (`:338-348`) with `"backlog" | "document"`, plus optional `title?: string` and `request?: string`.
- In `action()` case `"show"` (`:579-598`):
  - add `"backlog"` and `"document"` to `views`;
  - for `"document"`, require `text(input.title, 200)` and drop the block if it is missing;
  - copy `request` only if it matches `/^amun-r-[0-9a-f]{12}$/`.

**Task 3.3. Prompted path (the window).** In `work-session.tsx`:

(a) Extend `openView` (`:1533`) to accept `"backlog"` and `"document"`, plus a third parameter `title?: string | null` and a fourth `outputId?: string | null`.
- `backlog` → `onPane({ kind: "backlog" }); return "Backlog";`.
- `document`:
  1. Read the snapshot from `workStore.getSnapshot().snapshot ?? latest.current.snapshot`. Import `workStore` from `./store.ts`. Reason: F8. The document was filed by the awaited `apply-reply` just before.
  2. If `outputId` is given, use that item.
  3. Otherwise select Library items with `section === "output"` and `title.trim().toLowerCase()` equal to the requested title, trimmed and lowercased.
  4. Prefer items whose `workAreaIds` include `areaId`. Failing that, prefer items whose `groupId === context?.area.groupId`. Never use another group.
  5. Pick the newest `updatedAt`.
  6. If found: `onPane({ kind: "output", id: item.id }); return item.title;`. If not found: `return null`.

(b) In the `show` handler (`:1918-1932`):
- Pass `proposed.title` to `openView`.
- Store `outputId` in the card when the view is `document`. Find it the same way, or have `openView` return `{label, outputId}`; choose one and keep it consistent.

(c) Extend `openedViewOf` (`:32-61`):
- Accept `"backlog"` and `"document"` (a `document` card requires a string `outputId`).
- Return `outputId` and `late: value.late === true`.
- The click handler at `:3378-3380` calls `openView(card.view, card.filter, null, card.outputId)`.

(d) **Do not change the visible words "Opened ·"** in this phase. A late card shows the same words until Phase 7 approval (see 7.2).

**Task 3.4. Late path (the store).** In `packages/work-store/src/work-store.ts`, `case "apply-reply"`:
- Destructure `shows` from `readRequestBlocks` (`:3253-3254`).
- **After** the `for (const document of documents)` loop ends (just before `return {};` at `:3575`), add a block that runs **only when `command.raisePlans === true`**. That flag is set only on the late path (F2). This prevents a duplicate card on the prompted path, which the window already handles.

For each `show`:

1. `const known = request(show.request)`. If `null`, skip. Never fall back to the chat where the reply landed (rule 15).
2. Find the area type:

   ```sql
   SELECT type, group_id FROM work_areas WHERE id = ?
   ```

   with `known.areaId`.
3. If `show.view === "document"`, find the output:

   ```sql
   SELECT o.id, o.title FROM library_outputs o
   LEFT JOIN library_output_links l ON l.output_id = o.id AND l.work_area_id = ?
   WHERE lower(trim(o.title)) = lower(trim(?)) AND (l.work_area_id IS NOT NULL OR o.group_id IS ?)
   ORDER BY (l.work_area_id IS NOT NULL) DESC, o.updated_at DESC LIMIT 1
   ```

   Parameters: `known.areaId`, `show.title`, the area's `group_id`. Use `IS` so that a NULL group matches NULL. If nothing is found, skip.
4. Build the card:

   ```ts
   { kind: "opened-view", view, filter, label: showLabel(...), outputId: id|null, request: show.request, late: true }
   ```

5. **Idempotency:** read the cards already in that chat:

   ```sql
   SELECT card_json FROM work_messages
   WHERE work_area_id = ? AND <chat_id IS NULL or chat_id = ?> AND role = 'card'
     AND instr(card_json, '"opened-view"') > 0
   ```

   Parse each. Skip if one has the same `request`, `view`, `filter` and `outputId`.
6. Otherwise `say(known, "card", label, card)`.

**Task 3.5. Tests.** Add tests to `packages/domain/tests/` (new file `requests-show.test.ts`) and `packages/work-store/tests/first-mate-thread.test.ts`. Use the existing helpers in those files to create areas, chats and requests.

| # | Test |
|---|---|
| 1 | The parser accepts `backlog` and `document`+title. It drops `document` without a title, unknown views, and bad request refs. |
| 2 | `readRequestBlocks` returns `shows` only with a valid ref. |
| 3 | Late reply (`recordFirstMateReply`) containing a `document` block and a `show` block for the same request: exactly one `delivered` card and one `opened-view` card **in the request's chat**, the card's `outputId` equals the filed document, and `late: true`. |
| 4 | Re-applying the same late reply adds no second `opened-view` card. |
| 5 | Late `show` with an unknown ref adds nothing anywhere. |
| 6 | Late `show` for a title that exists only in another group adds nothing. |
| 7 | Prompted-path `apply-reply` (no `raisePlans`) with a `show` block adds **no** card. |
| 8 | Renderer `openView("document")` picks area over group, never another group. Test it as a pure helper: extract the selection into an exported function in `view-model.ts`, e.g. `findDocument(library, areaId, groupId, title)`, and unit-test that. |

**Watch out:**
- Process `shows` **after** `documents`, or a document delivered in the same reply will not be found.
- Do not use `shellReducer` `go` (F10).
- `show` never writes anything except the one card (rule 19).

**Phase 3 success metrics:**
1. All eight tests pass, and the full suite has zero new failures.
2. In the isolated packaged app, repeat Phase 1 T5 and the late test:
   - T5 opens Stories beside the chat.
   - "Open the RICE table" opens the T1 document.
   - The late research result leaves exactly one line in the asking chat while the captain is in another Product, and the captain's screen does not change.
   - The trace shows zero extra Pi turns caused by `show`.

---

### Phase 4. A document knows its chat (data only, no visible change)

**Purpose:** close G3's data half. The visible half is Phase 7.3.

**Task 4.1. Contract.** In `packages/contracts/src/work.ts`, add to the Library item `strictObject` (`:463-500`):

```ts
origin: z.strictObject({ workAreaId: id, chatId: id.nullable(), messageId: id, requestRef: z.string().nullable() }).nullable().default(null),
```

**Task 4.2. Snapshot.** In `work-store.ts`, in the snapshot builder before `library:` (`:541`), compute **one** map `outputId → origin` with **one** query:

```sql
SELECT m.id AS messageId, m.work_area_id AS workAreaId, m.chat_id AS chatId, m.card_json
FROM work_messages m
JOIN work_areas a ON a.id = m.work_area_id
LEFT JOIN work_chats c ON c.id = m.chat_id
WHERE m.role = 'card' AND instr(m.card_json, '"delivered"') > 0 AND a.status <> 'deleted'
ORDER BY (c.id IS NOT NULL AND c.kind = 'fork') ASC, m.created_at ASC, m.rowid ASC
```

- In JavaScript, parse `card_json`. Keep only `kind === "delivered"` with a string `outputId`. The **first** row per `outputId` wins, giving the original non-fork chat (F11).
- Set `origin` on each `section: "output"` item. Records get `origin: null`.

**Task 4.3. Tests.** In `packages/work-store/tests/`:

| # | Test |
|---|---|
| 1 | A delivered document has an origin equal to its chat and message. |
| 2 | After a revision (v2, same request), the origin is still the first card. |
| 3 | After forking that chat, the origin is still the original chat. |
| 4 | A document made with `save-output` and no card has `origin: null`. |
| 5 | A delivered document in an archived chat keeps its origin. |
| 6 | The snapshot still validates against the contract. |

**Watch out:**
- No N+1 queries.
- No migration.
- Do not use `prd_review_origins`. It maps PRD versions, not Library outputs, and is not needed: crew PRDs are filed through `apply-reply` with a `delivered` card (`attach-amun.ts:523-577`).

**Phase 4 success metrics:**
1. All six tests pass, with zero new failures.
2. Snapshot size and time are measured before and after on the isolated profile's `work.db` and reported.

---

### Phase 5. The PM method moves into Firstmate (a message, no Amun code)

**Purpose:** close G5. Firstmate owns the method; Amun keeps only the screen catalogue.

**Task 5.1.** In the **isolated** Firstmate home, send this message as the captain in a General chat:

> Keep a PM playbook for my work and use it to decide what happens next. Reuse what we already have; file it where you think best and tell me where.
>
> - RFP in: research mate checks scope and fit, PRD mate drafts the proposal. Proposal signed: PRD mate turns it into a BRD that cites each proposal section. BRD approved: PRD mate writes the PRD with my four questions first (What, Why, When, Cost; "unknown" plus what would settle it, never a guess).
> - RICE or MoSCoW when I ask or before a release cut. Show your inputs and mark guesses as assumptions.
> - Roadmap by quarter and a phase plan with dates and dependencies, from approved PRDs and BRDs only.
> - Executive pulse: sprint and roadmap status against my four questions, risks, slipped dates, decisions I need to make.
> - Every result is one Markdown document in an amun document block with my request reference and the type Amun lists (proposal, brd, prd, idea, rice, moscow, prototype, roadmap, gantt, brief, research). If a mate other than PRD wrote it, put its content in the document block yourself, because Amun files only the PRD mate's files automatically. Keep each whole reply under 150,000 characters; if a result is larger, split it into parts with titles ending "(part 1 of N)". When the result arrives in a later reply, add a show block with view document, its exact title and the same request reference.
> - Stories, tracker plans and sprints go through Amun's draft-stories, plan and show blocks. Never write to a tracker yourself.
> - Carry the Amun request reference through every handoff and report. Ask me one consequential question at a time.

**Task 5.2.** Record where Firstmate filed it: the file paths it reports. Read those files **read-only** to confirm.

**Task 5.3. Durability test.**
- Restart the isolated daemon and Pi. Start a new chat.
- Repeat Phase 1 T1–T4 and the late test **without** pasting the Task 1.1 helper text.
- Fill the Phase 1 table again.

**Task 5.4. Trim (FEP Task 4).** Only if Task 5.3 meets the success metric:
- trim the duplicated PM text the FEP names in `view-model.ts` (`areaTurnContext` PM prose only), `held-tasks.ts` (`prdDiscoveryCharterRule`, `:93-135`) and `contract-adapter.ts` (`:808-817` once-send);
- keep request identity, record facts and `amun-canvas.md`;
- re-run the full checks.

**Task 5.5.** Copy the exact tested message and the type shapes into `firstmate-layer/PM_PLAYBOOK.md`. Replace its "not installed" sections and keep the "reference only" status line.

**Watch out:**
- Markdown playbooks are guidance, not enforcement. Never move an approval, group check or validation out of code.
- Do not send anything to `/Users/tamersabry/Projects/firstmate`.

**Phase 5 success metrics:**
1. In Task 5.3, **at least 4 of the 5** prompts produce the correct document type, filed and linked to the asking work area, and the late test produces exactly one line.
2. If fewer than 4 pass, do **not** run 5.4. Report the failing rows instead.
3. After 5.4 (if run), the full checks show zero new failures.

---

### Phase 6. Restore the document "Open preview" (no visible change)

**Purpose:** close G4. Use case 7: crew wireframes open in Amun's browser pane.

**Task 6.1. Protocol.** In `packages/protocol/src/amun-rpc.ts`, add to the request union:

```ts
z.object({ id: z.string(), method: z.literal("output.preview"), outputId: z.string().min(1).max(64) })
```

Add the method name wherever the file lists methods for typing; follow how `work.inspect` is declared next to `:274`.

**Task 6.2. Preview module.**
- Create `packages/server/src/server/amun/output-preview.ts` by copying `openHtmlPreview` **verbatim** from `git show 25f11fe:apps/desktop/src/prototype-preview.ts` (random 32-byte path, `127.0.0.1:0`, the same CSP and headers, GET only, 10 s request timeout).
- Do **not** copy `openPrototypePreview` (F16).
- Add a class `OutputPreviews` that reproduces the old logic (F15):
  - `open(outputId, type, body)` runs `previewSource(type, body)`, imported from `@amun/domain` or the relative path used by other server files that import domain code; check an existing import of `packages/domain` in `packages/server/src/server/amun/` and copy that form;
  - for a URL, return it;
  - for HTML, reuse a page if the HTML is unchanged, otherwise close the old page;
  - cap at 8 pages, closing the oldest;
  - `closeAll()`.

**Task 6.3. Handler.** In `amun-rpc-handler.ts`:
- Create one `OutputPreviews` instance per handler.
- Add `case "output.preview"`:
  1. find the item in `this.deps.work.snapshot().library` with `section === "output"` and that `id`;
  2. if there is none, or `previewSource` returns null, return `{ message: "There is no prototype page to show in this item yet." }`;
  3. otherwise return `{ url, message: "Preview opened." }`;
  4. on error return `{ message: "The preview could not be opened. Please try again." }`.
- Call `closeAll()` wherever the handler or daemon disposes its resources. Find the existing dispose or close path in `attach-amun.ts` and hook into it. If none exists, close on process `exit`, and record which you used.

**Task 6.4. Bridge.** In `contract-adapter.ts`, next to the other `kind` branches (`:912-1014`), handle `message.kind === "output-preview"`:
- validate it with the existing contract (`packages/contracts/src/prototype.ts:40-46`);
- call `this.daemon.request("output.preview", { outputId })`;
- return `[{ kind: "output-preview-result", id: message.id, url?, message }]`, matching `:47-51`.

The window already handles the result (`work-session.tsx:1040-1045`, then `onPreview` → browser pane `:4369`).

**Task 6.5. Tests.**
- Port `git show 25f11fe:apps/desktop/tests/prototype-preview.test.ts` (the `openHtmlPreview` parts) to `packages/server/src/server/amun/output-preview.test.ts`.
- Add:
  - more than 8 opens close the oldest;
  - the same HTML reuses its URL;
  - a wrong path returns 404;
  - a non-GET request returns 405;
  - an output that is not a prototype returns the "no prototype page" message.

**Watch out:**
- Never serve a file path.
- Never bind to anything except `127.0.0.1`.
- Do not touch `PrototypeCard` (Phase 7.4 decides it).
- Wireframes over 200,000 characters never reach the Library (F6). That is covered by the Phase 5 message's split rule; do not raise limits.

**Phase 6 success metrics:**
1. All preview tests pass, and `npm run test:server` shows zero new failures.
2. In the isolated packaged app, a crew prototype document's "Open preview" opens it in the browser pane, within 3 s of the click, measured.
3. An item with no prototype shows the "no prototype page" message.
4. Restarting the daemon frees the ports (`lsof -iTCP -sTCP:LISTEN -P | grep 127.0.0.1` before and after).

---

### Phase 7. Owner approval batch, then the approved visible changes

**Purpose:** one Impeccable review for every visible change, so the owner decides once.

**Task 7.1. Build one before/after preview page** under `docs/preview/2026-11-25-firstmate-canvas/index.html`, using the `/impeccable` skill. It shows the current screen beside the proposed one for each item:

| Item | Change |
|---|---|
| 7.2 | A late line reads **"Open · <label>"** (instead of "Opened · <label>") when `card.late === true`. A prompted line keeps "Opened ·". |
| 7.3 | Clicking a Library document that has an `origin` opens it **in its originating chat**: `openWork(origin.workAreaId, undefined, {kind:"output", id}, origin.chatId, {messageId: origin.messageId, flash: true})`. That is the existing `openWork` (`app.tsx:460-475`) and the same reading focus `onOpenAt` uses (`:1290-1295`). A document with no origin keeps today's behaviour (F13). This adds no button. |
| 7.4 | Library labels in `rail.tsx:28-42`: `proposal` "Proposal", `rice` "RICE", `moscow` "MoSCoW", `roadmap` "Roadmap", `gantt` "Timeline", `brief` "Executive brief". |
| 7.5 | `PrototypeCard` (dead buttons, F16): the options from decision D2 (§4). |

**Task 7.2.** Wait for the owner's answer. Record the answer verbatim, with the date. Implement **only** the approved items.

**Task 7.3.** For each approved item, add a test:
- 7.2: render-level or pure-function test that `late` changes the words;
- 7.3: a test of the `openLibraryItem` decision, extracted as a pure function `libraryTarget(item, layout)` that returns the `openWork` arguments;
- 7.4: the `typeName` mapping;
- 7.5: per the chosen option.

**Phase 7 success metrics:**
1. The preview page exists, and the owner's decision on each of 7.2–7.5 is recorded.
2. Every approved item is implemented with its test.
3. Unapproved items are untouched.
4. Zero new failures.

---

### Phase 8. Final packaged acceptance and report

**Task 8.1.** Re-run every Task 0.2 command and `npm run dist:mac:beta`.

**Task 8.2.** In a **fresh** isolated profile and isolated Firstmate home (with the Phase 5 playbook filed again by the same message), run:
- the FEP acceptance table;
- Phase 1 T1–T5 and the late test;
- "Where is the Badge Desk PRD?" (use case 14);
- a Library click on the T1 document (if 7.3 was approved);
- "Open preview" on a crew prototype.

**Task 8.3.** Measure startup, working set (first screen and Home) and installed bytes the same way as Task 0.3. Report each as baseline → final → difference. A miss is reported as a miss.

**Task 8.4. Write the report** in `docs/reports/2026-11-firstmate-canvas-acceptance.md`:
- branch and commits;
- the files changed, with the reason for each;
- every test command with its counts;
- the Phase 1 and Phase 5.3 tables;
- the packaged results;
- the measurements;
- what remained fixtures-only or blocked;
- the owner's Phase 7 decisions.

Stop there. Do not push.

**Phase 8 success metrics:**
1. All checks are green with zero new failures against baseline.
2. Every acceptance row in §5 passes or is reported with evidence of why not.
3. Memory and size are reported against 500 MiB and 537,733,552 bytes, with the difference from baseline.
4. Nothing is pushed.

---

### 3.4 Blocked work

If a live credential or the packaged app is unavailable:
- run the tests with fixtures;
- mark only that live row as **blocked**, with the exact missing item;
- continue with the next independent phase.

Phases 2, 3, 4 and 6 do not depend on live Firstmate output to be coded and unit-tested. Their packaged metrics do.

---

## 4. Decisions for the owner (each has a default, so the executor never waits)

| ID | Decision | Facts | Default if no answer |
|---|---|---|---|
| D1 | Approve Phase 7.2 (late line reads "Open ·") | "Opened ·" would be untrue on a late line, because nothing opened (F7) | Keep "Opened ·" (no visible change) |
| D2 | `PrototypeCard` dead buttons | The old flow bypassed Firstmate and cannot return (F16). Options: (a) leave as is; (b) "Explore a prototype" sends "Ask UX to build a clickable prototype for <product> from the approved PRD" to Firstmate as an ordinary chat message, and "Open the preview" opens the newest `prototype` document of that product through Phase 6; "Read the feedback" is removed; (c) hide the card. | (a) leave as is |
| D3 | Library click opens the document in its original chat (7.3) | Today it opens in the current or first linked area and never the original chat (F13) | Keep today's behaviour |
| D4 | New labels (7.4) | Unknown types show raw keys (F21) | Keep raw keys |
| D5 | Version history across requests | A new request makes a new document even with the same title (F4). Changing that needs store code. | Keep (no code); `show document` opens the newest |
| D6 | When the Phase 5 message goes to the personal Firstmate | Amun never writes it (rule 4) | Not sent; the owner sends it |
| D7 | Charts (Gantt bars, RICE chart) | Tables render today (F20); charts are a design round | Not built |

---

## 5. Acceptance (what "done" means)

| Area | Pass condition |
|---|---|
| Catalogue | The protocol comes from `amun-canvas.md`; it differs from the old text only by the planned edits; the built renderer contains it |
| Documents | Each PM request yields one typed Library document linked to its work area and a delivered card in its chat |
| Show (prompted) | Opens the named screen or document beside the chat, never another group |
| Show (late) | Exactly one line in the request's chat; none for an unknown ref, a replay or the prompted path; the captain's screen never changes |
| Origin | Every delivered document has an origin pointing at the original non-fork chat; manual documents have none |
| Preview | "Open preview" opens saved prototype HTML on loopback; at most 8 pages; ports freed on restart |
| Playbook | At least 4 of 5 PM prompts work after restart without helper text |
| Integrity | `vendor/firstmate/` pristine; no migrations; no new dependencies; no personal Firstmate edits |
| Budgets | Memory against 500 MiB and size against 537,733,552 bytes, reported against baseline |

---

## 6. Files this plan changes

| Phase | File | Change |
|---|---|---|
| 2 | `packages/amun-ui/src/styles.d.ts` | `*.md?raw` declaration |
| 2 | `packages/amun-ui/src/rebuild/amun-canvas.md` (new) | Screen catalogue |
| 2 | `packages/amun-ui/src/rebuild/view-model.ts` | Load the catalogue |
| 2 | `packages/amun-ui/tests/amun-canvas.test.ts` (new) | Tests |
| 3 | `packages/domain/src/work/requests.ts` | `shows`, `showLabel` |
| 3 | `packages/amun-ui/src/rebuild/view-model.ts` | `show` parser, `findDocument` |
| 3 | `packages/amun-ui/src/rebuild/work-session.tsx` | `openView`, `openedViewOf`, card click |
| 3 | `packages/work-store/src/work-store.ts` | Late `show` card |
| 3 | `packages/domain/tests/requests-show.test.ts` (new); `packages/work-store/tests/first-mate-thread.test.ts` | Tests |
| 4 | `packages/contracts/src/work.ts` | `origin` |
| 4 | `packages/work-store/src/work-store.ts` | Origin map |
| 4 | `packages/work-store/tests/*` | Tests |
| 5 | `firstmate-layer/PM_PLAYBOOK.md` | Tested message |
| 5 | `view-model.ts`, `held-tasks.ts`, `contract-adapter.ts` | Trim, only if 5.3 passes |
| 6 | `packages/protocol/src/amun-rpc.ts` | `output.preview` |
| 6 | `packages/server/src/server/amun/output-preview.ts` (new) + test | Preview server |
| 6 | `amun-rpc-handler.ts`, `contract-adapter.ts` | Wiring |
| 7 | `work-session.tsx`, `app.tsx`, `rail.tsx`, `prototype-card.tsx` | Approved items only |
| 8 | `docs/reports/2026-11-firstmate-canvas-acceptance.md` (new) | Report |

**Never touched:** `vendor/firstmate/`, `migrations.ts`, provider and publishing code, approval flows, the composer, `package.json` dependencies.

---

## 7. Use-case coverage after this plan

| # | Use case | How |
|---|---|---|
| 1 | RFP → proposal | Playbook (P5) + `proposal` doc + `show document` (P3) |
| 2 | Signed proposal → BRD | Playbook + `brd` |
| 3 | BRD → PRD with 4-question gate | Playbook + existing PRD relay |
| 4 | Idea capture | Existing intake + `idea` |
| 5 | RICE | `rice` table |
| 6 | MoSCoW | `moscow` task lists (ticking saves) |
| 7 | Wireframe | Crew `prototype` doc + P6 preview |
| 8 | Roadmap by quarter | `roadmap` doc; Roadmap screen unchanged |
| 9 | Project plan | `gantt` table (bars: D7) |
| 10 | Epics and stories | FEP 3.1 + Stories screen |
| 11 | Tracker sync | Existing `plan` → approval → receipt + FEP 3.2 |
| 12 | Sprint view | Sprints screen + `show sprints` |
| 13 | Library → its chat | P4 data + 7.3 (D3) |
| 14 | "Where is …?" | P3 `show document` |
| 15 | Executive pulse | `brief` |

---

## 8. Things that will trip you up

1. A fresh `npm ci` needs `npm run build:server` before `npm test`, or 12 server test files fail to resolve packages (F22).
2. `latest.current.snapshot` can be stale after an `await`; read `workStore.getSnapshot()` (F8).
3. The prompted path also calls `apply-reply`. Gate late `show` handling on `raisePlans === true`, or every `show` makes two cards (F2).
4. Documents without a known `request` are not linked to any work area (F3). That is why the catalogue text now says "always include request".
5. A reply over 200,000 characters loses its documents silently (F6).
6. A fork copies delivered cards (F11). The origin query orders forks last.
7. `shellReducer` `go` leaves the chat (F10). Never use it for `show`.
8. A stale `~/Applications/Amun Firstmate Latency Test/…app` has the same bundle ID. Launch by path.
9. PR #10 stays closed. The "Agents unblock routing" was reverted by the owner; do not reintroduce it.

---

## 9. Research references (opened 24 Nov 2026)

**A2UI.**
- Repo: https://github.com/a2ui-project/a2ui (`github.com/google/A2UI` shows this repo).
- v0.9 protocol (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`; client `action`, `error`): https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/docs/a2ui_protocol.md
- v1.0 spec (adds `callRendererFunction`, `agentFunctionResponse`, `callAgentFunction`, `allowedCallers`): https://a2ui.org/specification/v1.0-a2ui/
- Posts: https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/ and https://developers.googleblog.com/en/a2ui-10-build-delightful-fast-reliable-agentic-experiences/

**AG-UI.** An event transport, not a UI spec.
- Repo: https://github.com/ag-ui-protocol/ag-ui
- Introduction: https://docs.ag-ui.com/introduction
- Events (lifecycle; text; tool call Start/Args/End/Result; `StateSnapshot` replaces state; `StateDelta` is an RFC 6902 patch; activity; reasoning; subagent): https://docs.ag-ui.com/concepts/events

**CopilotKit.**
- Patterns repo (controlled = AG-UI, declarative = A2UI / Open-JSON-UI, open-ended = MCP Apps; `useFrontendTool`, `useComponent`, `createA2UIMessageRenderer`, `MCPAppsMiddleware`): https://github.com/CopilotKit/generative-ui
- Docs: https://docs.copilotkit.ai/generative-ui

**MCP Apps.**
- Announcement: https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
- Spec: https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx
- MCP-UI: https://mcpui.dev/

**Other specs and SDKs.**
- OpenAI Apps SDK: https://developers.openai.com/apps-sdk/build/chatgpt-ui
- Vercel AI SDK: https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces
- json-render: https://github.com/vercel-labs/json-render
- LangChain: https://docs.langchain.com/oss/python/langchain/frontend/generative-ui-overview

**Anthropic.**
- https://aaif.io/md/blog/anthropics-lessons-from-building-mcp-apps
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- https://code.claude.com/docs/en/memory

**Markdown files as agent memory.**
- https://agents.md/
- https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus

**Practitioners.**
- https://dev.to/obetomuniz/who-owns-the-surface-22n9
- https://dev.to/infoxicator/rethinking-ui-in-agent-driven-systems-10nd
- https://hackernoon.com/how-i-actually-ship-generative-ui-without-letting-the-llm-write-react
- https://verygood.ventures/blog/generative-ui-hallucinations-four-layer-defense/
- https://ajing.github.io/posts/2026-01-01-generative-ui-doesnt-move-the-needle-steering-does

**Hacker News** (`news.ycombinator.com/item?id=`):
- 46286407, 50461919 (A2UI)
- 47439300 (Markdown protocol)
- 49613182 (OUI-1)
- 46020502 (MCP Apps)
- 46746570 (json-render)
- 46138473 (generative UI)
- 42934190 (chat is a bad UI)
- 34549378 (natural language is the lazy UI)
- 47364116 (Spine Swarm)
- 38545207 (CopilotKit)
- 39927698 (NN/g)

**Not readable** (nothing in this plan relies on them):
- Reddit and Stack Overflow: tools refused.
- Lobsters: "Access Denied".
- Code Review SE: not searched.
- Hashnode and GitHub Discussions: nothing relevant.

**Why A2UI, AG-UI and CopilotKit are not adopted (facts):**
- Firstmate emits ` ```amun ` text blocks, not A2UI messages or AG-UI events (`work-session.tsx:2082`).
- Amun reaches Pi over Paseo (rule 8).
- The repo has no A2UI renderer and no AG-UI client.
- Amun already uses the "controlled" pattern: its own catalogue and validated actions.
- Revisit only if Amun hosts third-party agents or a second client platform.

---

## 10. Planner's verification log (24 Nov 2026, worktree `amun-firstmate-agentic-ui-a05848` at `8f77595`)

- `npm ci`: exit 0.
- `npm run typecheck:amun`: exit 0.
- `npm test` before `build:server`: 12 files failed to resolve `@amun/work-store` or `@getpaseo/protocol`; 1,266 tests passed.
- `npm run build:server` then `npm test`: 177 files, 1,339 tests, all passed.
- `scripts/check-firstmate-pristine.sh`: exit 0.
- `?raw` probe:
  - Vitest test passed;
  - `tsc` without the declaration gives TS2307, and passes with it;
  - `vite build` inlined the text.
- Git: `25f11fe` added `output-preview` and its preview server. `4ae3c77` deleted `apps/desktop/src/` including both handlers. `PrototypeSession` used `sendDelivery` (tmux).
- Two external plans were stress-tested. Rejected claims:
  - AG-UI's repo given as `CopilotKit/generative-ui`;
  - A2UI v0.9 message names (they were v0.8);
  - "prototype preview already works";
  - "Library already links to its chat";
  - a new `canvas` action, and `go`-based navigation;
  - a catalogue copy inside Firstmate's home;
  - 90k/100k limits on the filing path (F6);
  - restoring `PrototypeSession`;
  - the `prd_review_origins` fallback;
  - line-count estimates.
