# Notion hosted MCP — authentication acceptance and remaining publication gates

Parent commit: 06fe2e7; changes recorded with this evidence commit. User replaced Notion token onboarding with hosted MCP browser OAuth; ADR-011 records the stress test and later-milestone boundaries.

Public discovery returned the official resource/issuer, PKCE S256, public-client authentication, dynamic registration, issuer response support and CIMD. Pinned official SDK 1.32.2 was inspected: auth() automatically retries invalid_grant; Amun's provider deliberately throws after clearing tokens to stop that retry. MCP transport has no authProvider, so calls cannot automatically reauthenticate/replay. Current connector only checks tools/list and notion-get-self, never publishes.

RED: missing callback/provider modules; native Notion command rejected by contracts. GREEN: actual pinned SDK against controlled OAuth endpoints proves PKCE exchange, registration reuse, terminal invalid_grant with one refresh and no automatic browser reopen. Callback tests cover state, issuer, duplicated parameters, Host, method/path, expiry/cancel and invalid listener settings. Provider tests cover issuer-bound credentials, browser targets and redirect refusal. These are not live workspace evidence.

Full check: 345 tests, lint, strict types, formatting passed. Coverage thresholds passed; aggregate measured line coverage 91.79% (domain/governance retain their own thresholds).

Source UI passed (595 ms) and packaged UI passed (4.1 s): Edge/Dia selector, no token field, safe missing-connection failure. The first Electron test caught a sandbox preload shared-chunk import introduced by bundling the SDK. Preload now builds standalone; sandboxing remains enabled. Accessible selector names were also fixed. The packaged UI run preceded the final one-line change to use the already secured workspace directory for the refresh lock; that change passes full checks and needs final packaged revalidation.

Live packaged consent was started in the existing isolated M1 acceptance profile, explicitly using Edge. User authorization, expected workspace identity, durable reconnect/refresh, disconnect/revocation, rate limits, bounded MCP results, target discovery and approved publication remain OPEN. The chat's Notion connector is not evidence for Amun authentication. No page was published. The older REST draft adapters are not the chosen production route.

Logs: /tmp/amun-mcp-loopback-red.log, /tmp/amun-mcp-provider-red.log, /tmp/amun-mcp-command-red.log, /tmp/amun-mcp-check2.log, /tmp/amun-mcp-coverage.log, /tmp/amun-mcp-ui-source.log, /tmp/amun-mcp-ui-packaged.log.

## Live follow-up — 2026-11-06, 22:22–22:40 +04

The user completed official Notion consent in Microsoft Edge. The packaged Amun service independently reached ready through notion-get-self. After reopening the packaged acceptance profile, it reused the saved grant without another authorization, identified the expected workspace (Tamer’s Space), and read the selected Document Hub reference through notion-fetch. No page was created. This proves authentication, persisted-grant reuse and destination readability, not publication permission or schema validation.

A separate Node diagnostic triggered a macOS Keychain access prompt. It was stopped before obtaining credentials; the user was advised to deny it. Subsequent verification ran inside the packaged Amun service. No external diagnostic credential extraction is required.

Added tests prove twenty concurrent near-expiry checks cause one refresh, token rotation is saved before callers proceed, unknown MCP tools are blocked, identity projection excludes private fields, and oversized MCP JSON/SSE responses are rejected. Final full check passed 352 tests. Packaged Notion settings and native login/logout tests passed together (12.2 seconds). Logs: /tmp/amun-m1-check-final.log, /tmp/amun-notion-service-ui.log, /tmp/amun-notion-service-package.log.

Still OPEN: live expired-token refresh, disconnect/revocation behavior, rate-limit handling, verified destination schema/identity, exact approved publication through MCP and uncertain-result reconciliation. Publication remains blocked until the user reviews the exact content and destination. No publication approval has been inferred from sign-in.

## Destination and exact review follow-up

The first strict schema check failed against the live database: official MCP wraps collection URLs in `{{…}}`. A sanitized failing fixture reproduced this, then the parser was corrected without accepting foreign hosts, mismatched page IDs or ambiguous data sources. The packaged Amun service subsequently verified Document Hub as a database and its title field. The connected chat Notion tool supplied format reference only; the later packaged Amun check supplies the acceptance evidence.

Conversation publication now uses the official MCP create-pages tool, a service-retained redacted preview, a verified destination, a workspace-bound durable action and exact-review approval. A new append-only migration permits workspace-scoped notion_publish actions without manufacturing a product; other actions still require product scope. Migration tests preserve existing approvals/outbox records, refuse orphaned references, roll back and restore foreign-key enforcement. Only the selected action is dispatched. The transport has no automatic auth replay; malformed, warning, async, lost or uncertain results do not trigger another create.

Source native-session/import/Notion UI tests pass (6.0 seconds). Six packaged authentication/import/native-session/Notion tests pass (27.8 seconds). Full check passed 367 tests before the additional import security regression, which also passed separately. Governance coverage passes: domain 97.24%, outbox 98.52%, Notion review 93.75%; measured aggregate coverage is 89.04% and is not represented as a global 90% result.

A clearly labelled acceptance fixture was prepared in the isolated Amun profile and the exact-content review displayed. The harness did not click approval, and no page was published. The live publication gate remains pending the user's review and approval. Logs: /tmp/amun-m1-import-e2e.log, /tmp/amun-m1-review-packaged.log, /tmp/amun-m1-review-coverage.log. The review field width was subsequently corrected; final package check remains required for that small UI change.

Final follow-up: full check passed 368 tests. The final packaged native-session/import/Notion UI tests passed (7.5 seconds), including the readable review field. The live packaged application again verified Document Hub and displayed the exact fixture review. Approval was left to the user; publication was not clicked by the harness. Logs: /tmp/amun-m1-before-commit.log and /tmp/amun-m1-final-package-ui.log.

## 2026-11-07 publication-result discrepancy

Tested implementation: `6f83fda`. The user reported “Published successfully”. Read-only verification of the running packaged M1-acceptance profile found two `notion_publish` actions, both `pending_approval`, and no `notion.receipt.*` records. The default Amun workspace contained no publication actions. The running Amun main process still uses the intended M1-acceptance profile. A separate read-only connected Notion search scoped to Document Hub for “Amun M1” returned no results. This search is corroboration only, not proof of absence or proof of Amun authentication.

No write was retried, no approval was inferred from the result report, and no publication gate was closed. Asked the user whether the approval button was clicked inside Amun and for the resulting page URL or exact visible message. Until reconciled, publication remains unverified. PR #2 currently reports one passing check and zero failures at this implementation. Neumorphism remains awaiting explicit approval.

## 2026-11-07 05:04 +04 actual publication and misleading status error

The later approval click did publish. Read-only verification found action `3de53661-9e29-4a80-8069-0d7465dd039a` succeeded and its durable receipt for page `4113581d-e3a9-81cc-9eaf-e236f2bdcd7c`. Fetching that page confirmed the exact reviewed fixture title, both labelled fixture messages and the Document Hub data-source parent. Its creation time is 2026-11-07T01:04:15.955Z (05:04 +04). No duplicate retry or extra publication was performed. The earlier observation of pending approvals was accurate before this click.

Page: https://app.notion.com/p/4113581de3a981cc9eafe236f2bdcd7c

Root cause of the screenshot banner: workspace-level Notion actions have a null product ID, but status activity validation required a product string. While the action was executing, workspace snapshot validation failed and emitted a generic workspace error. The publication itself completed. A failing in-memory regression reproduced the banner for executing/unknown/failed states; the fix permits explicit workspace scope on activity records and keeps that activity visible across product views. This does not relax product requirements on other domain entities.

Source test evidence: `/tmp/amun-workspace-publication-red.log`; full checks after status fix: `/tmp/amun-publication-status-check.log` (369 tests). No signing/release gate or broader M1 completion is inferred from this success.

Final validation for the status and placement fix: 369 unit tests plus lint/types/format passed (`/tmp/amun-journey-check.log`). Seven source journey tests passed (`/tmp/amun-journey-e2e.log`) and the same seven passed against the packaged app (`/tmp/amun-journey-packaged.log`). The new journey assertion first failed because native conversation tools were inside Models (`/tmp/amun-conversation-route-red.log`). The first packaged status probe was attempted before packaging completed and could not find the executable; after final packaging the complete suite passed. No external publication is performed by these disposable-profile tests.

## 2026-11-07 disconnect, receipt and reading journeys

A confirmed local Disconnect Notion action now serializes against refresh/credential work, cancels pending login, deletes only this workspace's protected credential record and saved destination, and clears the cached identity. Concurrent connects are refused while deletion is pending. Protected-storage deletion failures are not represented as successful disconnect. This is local credential removal, not a claim of server-side grant revocation; the UI states that distinction and preserves existing pages. Unit isolation/locking/failure tests and source/packaged confirmation/cancel tests pass. RED: `/tmp/amun-disconnect-red.log`.

Conversations now provides a bounded, redacted text view with the active session ID and explicit counts for omitted internal/non-text entries. Empty sessions are shown honestly. No tools, inference or publication are triggered by reading. Source/package acceptance reads the actual owned SDK session and excludes the credential canary. RED: `/tmp/amun-conversation-view-red.log`. This is not a claim that the still-open composer/streaming/resource command families are complete.

Published conversations restores up to 50 verified durable receipts with copyable Notion URLs. It validates each receipt against its stored approved action and excludes corrupted or non-successful records; viewing receipts never executes a write. The packaged live acceptance profile restored the exact existing fixture receipt. RED: `/tmp/amun-receipts-red.log`. URL projection tests reject foreign hosts, scripts, queries and oversized lists.

Validation: full checks passed 375 tests before one additional contract test; the final contract suite passed all three tests. Coverage thresholds passed (domain 97.24% lines; Notion review 96%). Four relevant source journeys passed and the same four packaged journeys passed. Logs: `/tmp/amun-m1-followups-check.log`, `/tmp/amun-m1-followups-coverage.log`, `/tmp/amun-m1-followups-source.log`, `/tmp/amun-m1-followups-packaged.log`.

Live packaged disconnect then succeeded in the isolated M1 profile; a subsequent Test connection refused access. The user completed official Edge consent and packaged Amun then verified reconnection successfully. No new external publication or personal configuration change occurred. Remaining real refresh/error/lifecycle acceptance is not silently waived.

Final pre-commit checks passed 376 tests, lint, types and formatting (`/tmp/amun-m1-followups-final-check.log`).

## 7 November · Interrupted publication recovery

A source Electron regression first observed the action and outbox both stuck at unknown after service restart despite a matching saved page receipt. Startup now validates the receipt against the action marker, approved payload hash and destination before completing both records atomically. A separate interrupted create with no receipt remained unknown in the same launch. Conversations showed its title under Unconfirmed publications and showed the confirmed page URL for the recovered action.

All 424 unit tests and the three relevant Electron journeys in each of the source and packaged builds passed. The interruption test used a real SQLite file with a fixture create response. It made no Notion write. Recovery when the remote response never reaches the service remains open.

### Publication identity and interrupted delivery, 7 November

Document Hub has no dedicated searchable publication-ID property. Amun includes the one-line UUID footer in its exact review there. A database with a dedicated text property must pass a scoped parameterized query before Amun offers property-based publication. Both forms bind the ID and destination to the approval. An interrupted send stays sent-unknown. Recovery may search or fetch a supplied URL and verify the immediate parent and ID. The PM can retry that read. Recovery has no create operation.

The regression suite covers offline failure before and during send, lost reply, duplicate titles, modified or removed footers, and a saved receipt across service restart. A negative test initially accepted a property-like block written inside the conversation. The resolver now reads properties only from Notion's page header. All 429 unit tests, lint, type checking and formatting passed. The earlier verified page predates publication IDs and cannot serve as live evidence for this change.

On this Mac, all three publication E2Es passed in the newly packaged arm64 app. The restart fixture persisted sent-unknown before closing its database and launching a fresh service. The full source E2E run passed 24 tests and skipped the packaged-only rollback test. A fresh exact review in the packaged acceptance profile displayed Document Hub, the synthetic conversation and its new publication-ID footer.

### Approved same-title page and read-only recovery

On 7 November the packaged acceptance window showed the publication success message. The persisted action for publication ID `af4ebf45-2c7d-4720-98b3-f63823e16f22` progressed from pending to succeeded and confirmed. The hosted page in Document Hub is `4113581d-e3a9-818b-96e6-d337a0d4f242`. Its footer matched the reviewed ID exactly. The earlier same-title page has a different receipt. No repeat create was submitted.

The live hosted fetch supplied a canonical URL and omitted the separate page ID. The first production lookup failed validation at that field. A regression reproduced this response. The resolver now checks the canonical URL against the requested page and validates any additional ID returned. Amun's read-only lookup then identified the exact approved page. A separately seeded in-memory ledger simulated a lost response to a create and recovered from sent-unknown to confirmed against the real workspace using only MCP reads. The actual approved create returned normally.

Two Amun processes were running against the same acceptance profile. The renderer for the reviewed publication showed success with the approval control gone. This evidence establishes the final result, but cannot identify which window was frontmost at the earlier screenshot. A regression launched a second process against a disposable open profile and reproduced competing owners. Electron now returns a second launch to the existing window and preserves its current screen.

Opening the share preview used to leave keyboard focus above the off-screen review. A failing native Pi E2E reproduced that behavior. The preview and final approval now focus the review heading, keeping the exact content before the approval button in reading order. The source suite passed 25 tests with one packaged-only skip. All five targeted packaged journeys passed, along with all 430 unit tests, lint, types and formatting. These tests ran in disposable profiles and did not republish.

### Live refresh and provider rejection

The owner completed consent in Edge for a new disposable packaged profile. A read-only comparison of the registered client identities confirmed its registration differs from the working Document Hub profile. For the refresh test, the harness overrode the local expiry reading to exercise the due path without waiting for natural expiry. Twenty concurrent calls to the production connection produced one real refresh request and one Keychain save. The refresh token rotated, the client registration was reused, and the workspace identity read succeeded.

In a separate in-memory credential fixture, Notion rejected a synthetic invalid refresh token with invalid_grant. Amun cleared the fixture's credentials, made exactly one refresh request and opened no browser. Neither real grant was revoked by that test. The remaining live revocation check requires the owner’s decision for the disposable grant.

### Live revocation, 7 November

After explicit approval, the probe rechecked that the disposable profile and its OAuth registration were distinct from the working acceptance profile. It sent one revocation request for the disposable refresh token to the endpoint in Notion's issuer metadata. Notion returned HTTP 200. The production connector subsequently attempted refresh once, cleared the disposable credentials and returned reconnect-required. A separate read through the working profile still matched the approved Document Hub page receipt.

The packaged disposable window received a connection-check click but the reconnect notice was not observed. The utility process held the refresh lock and its stack showed a blocking macOS Keychain lookup. The renderer gate remains open until this check returns and the reconnect message is visible.

The owner completed the Keychain prompt at 12:51 +04. A read-only inspection of the existing disposable packaged window then clicked Test Notion connection and observed the reconnect guidance (one matching notice). The renderer gate for this revocation trial passed.

### T016c source consent and process locking, 7 November

At base revision `4d49582` a fresh source Amun profile initiated official Edge sign-in and reached ready through the production workspace identity read. After closing and reopening that profile, Test Notion connection returned the expected workspace name from the saved grant. There was no publication. The separately revoked packaged test grant was left disconnected.

Five independent Node processes concurrently acquired the production refresh lock on one disposable private directory. Each read a test generation number, waited 50 ms and incremented it. All five increments survived. This exercises process serialization separately from the live single-rotation trial. Together with the packaged consent, persisted registration, disconnect, revoked grant, reconnect guidance, validated callback and publication recovery evidence above, this closes T016c.
