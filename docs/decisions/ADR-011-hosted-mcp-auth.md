# ADR-011 — Hosted MCP browser authentication

Status: accepted direction; live Notion acceptance pending (2026-11-06).

Prefer each provider's official hosted MCP with external-browser OAuth; Azure DevOps is excepted. Notion uses https://mcp.notion.com/mcp. No manual-token onboarding or REST-token fallback. Edge/Dia are explicit browser choices. This supersedes the Notion token path in T016, not the governance requirements in ADR-010.

## Stress-test corrections

- Protected-resource metadata is RFC 9728, not RFC 9470 (the latter typo also appears in Notion's guide). Validate issuer/resource/endpoint origins and reject redirecting token requests.
- Pin and inspect the actual SDK API. Version 1.32.2 was verified in the registry; do not mix v2 split-package examples into v1 code.
- Loopback callback must bind only 127.0.0.1, validate exact Host/path/method, state and authorization issuer, reject duplicate parameters, expire, and be single-use. Never display callback codes/errors or log query strings. Persist registration and reuse its redirect URI; a fresh random port is not assumed compatible with an existing registration. Binding failure must not silently register another client.
- Serialize refresh across service processes using the existing protected-profile lock, reread tokens inside the lock, persist rotation before issuing requests. Terminal invalid_grant means reconnect. An uncertain refresh outcome is not an unrestricted retry opportunity.
- Service owns credentials and MCP calls. Authenticated does not mean model inference or write approval. Preserve existing personal sessions and configurations.
- Exact tool-name classification only: unknown tools are blocked pending review, not implicitly readable or executable after generic approval. Do not trust server annotations or list-* prefixes as authority.
- No automatic SSE fallback after an uncertain write, automatic write retries, or retry merely because search did not find a marker. Missing search results do not prove absence. Unknown outcomes stay unresolved until reliable reconciliation or human intervention.
- Approval binds the final content, title, destination, operation and any marker/metadata. Do not add hidden content after review or modify the destination database schema without authorization. Verify marker survival before relying on it.
- MCP credentials cannot authenticate REST requests. Do not add a second grant merely to bypass an MCP limitation. Parent permissions are inherited; do not promise publication is private without checking them.
- Disconnect/reconnect semantics must distinguish retaining registration from forgetting it, and local deletion from verified remote revocation. SDK automatic refresh/replay behavior needs explicit testing.

## Scope and verification

M1 includes Notion browser connection, read validation and reviewed conversation publication (T016c/T022b). T037 bridge exposure, T048 broader publishing and T049 sync stay in later milestones. M0 is not reopened. Public discovery on 2026-11-06 advertised PKCE S256, public token authentication, dynamic registration, issuer responses and CIMD. This is not proof of successful consent, accepted loopback redirect, token refresh or publication.

Sources: https://developers.notion.com/guides/mcp/build-mcp-client ; https://www.rfc-editor.org/rfc/rfc9728.html .
