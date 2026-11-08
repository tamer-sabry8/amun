# M1 Notion sharing boundary — 2026-11-06

User decision: Notion only for R1 sharing. Pi `/share` is disabled with no Radius/gist fallback. Transfrm.ai is R2 reference. See ADR-010 and open T022b.

## Implemented and verified

- Server-side refusal of native Pi `/share`, even when other providers are configured.
- Native Share to Notion preview of the selected session's current branch: user/assistant text only; reasoning, tool results and nontext content omitted with a count.
- Secret removal runs in the SDK worker before renderer delivery. Registered Amun Pi credential values and encoded variants plus detectable credential/header/private-key patterns are removed. Automatic redaction cannot identify every arbitrary confidential string; exact-content review is mandatory.
- Approval policy binds both redacted content digest and chosen parent. Missing connection, missing parent, changed content/destination and malformed parent IDs refuse publication.
- Fixed official Notion HTTPS API transport: no redirects or retries, 20-second deadline, bounded response, sanitized failure. Page adapter preserves literal text instead of interpreting conversation Markdown as external embeds. It validates returned page/parent identity, caps content and serialized UTF-8 bytes, and treats unexpected responses/network failures as unknown.
- Source native UI acceptance: 4.2 seconds. Packaged native UI acceptance: 10.9 seconds. Both verify the actual SDK fixture preview removes its secret canary and the publish control remains disabled. These are synthetic conversation fixtures, not live Notion publication.
- Coverage at the preview increment: 309 unit tests; domain 97.16% line coverage; aggregate configured coverage 92.14%. Added API-adapter tests are reported in the follow-up checked commit.

TDD logs: `/tmp/amun-notion-preview-check.log`, `/tmp/amun-notion-preview-source.log`, `/tmp/amun-notion-preview-packaged.log`, `/tmp/amun-notion-coverage.log`; API adapter missing-module RED and GREEN logs `/tmp/amun-notion-client-{red,green}.log`, `/tmp/amun-notion-transport-{red,green}.log`. Malformed parent RED `/tmp/amun-notion-parent-red.log`; serialized UTF-8 budget RED `/tmp/amun-notion-byte-red.log`. Final checks `/tmp/amun-notion-final-check.log`.

Official API reference checked: https://developers.notion.com/reference/post-page (Notion-Version 2026-03-11). No SDK or mock result is counted as live acceptance.

## Still open

The API adapter is not connected to the durable outbox or native publication controls. Parent selection, approval/execution wiring, persisted result/reconciliation and live new-page acceptance remain open. Unexpected outcomes must never trigger an automatic repeat create.

Read-only UI discovery found zero saved Notion connections in Amun's existing M1 acceptance profile. Standard global Claude/Codex MCP configurations contained no Notion entry; Pi's standard MCP file was absent. This is bounded discovery, not a claim about every possible configuration or the desktop assistant's connectors. User input is needed for a chosen Notion parent; credentials must be entered in Amun, never chat. No content has been uploaded and no personal credential store was copied.
