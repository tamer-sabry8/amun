# Notion hosted MCP — implementation and pending live acceptance

Parent commit: 06fe2e7; changes recorded with this evidence commit. User replaced Notion token onboarding with hosted MCP browser OAuth; ADR-011 records the stress test and later-milestone boundaries.

Public discovery returned the official resource/issuer, PKCE S256, public-client authentication, dynamic registration, issuer response support and CIMD. Pinned official SDK 1.32.2 was inspected: auth() automatically retries invalid_grant; Amun's provider deliberately throws after clearing tokens to stop that retry. MCP transport has no authProvider, so calls cannot automatically reauthenticate/replay. Current connector only checks tools/list and notion-get-self, never publishes.

RED: missing callback/provider modules; native Notion command rejected by contracts. GREEN: actual pinned SDK against controlled OAuth endpoints proves PKCE exchange, registration reuse, terminal invalid_grant with one refresh and no automatic browser reopen. Callback tests cover state, issuer, duplicated parameters, Host, method/path, expiry/cancel and invalid listener settings. Provider tests cover issuer-bound credentials, browser targets and redirect refusal. These are not live workspace evidence.

Full check: 345 tests, lint, strict types, formatting passed. Coverage thresholds passed; aggregate measured line coverage 91.79% (domain/governance retain their own thresholds).

Source UI passed (595 ms) and packaged UI passed (4.1 s): Edge/Dia selector, no token field, safe missing-connection failure. The first Electron test caught a sandbox preload shared-chunk import introduced by bundling the SDK. Preload now builds standalone; sandboxing remains enabled. Accessible selector names were also fixed. The packaged UI run preceded the final one-line change to use the already secured workspace directory for the refresh lock; that change passes full checks and needs final packaged revalidation.

Live packaged consent was started in the existing isolated M1 acceptance profile, explicitly using Edge. User authorization, expected workspace identity, durable reconnect/refresh, disconnect/revocation, rate limits, bounded MCP results, target discovery and approved publication remain OPEN. The chat's Notion connector is not evidence for Amun authentication. No page was published. The older REST draft adapters are not the chosen production route.

Logs: /tmp/amun-mcp-loopback-red.log, /tmp/amun-mcp-provider-red.log, /tmp/amun-mcp-command-red.log, /tmp/amun-mcp-check2.log, /tmp/amun-mcp-coverage.log, /tmp/amun-mcp-ui-source.log, /tmp/amun-mcp-ui-packaged.log.
