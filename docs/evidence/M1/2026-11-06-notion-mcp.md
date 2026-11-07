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
