# ADR-007: Reuse installed tools and connect through APIs or MCP

Status: accepted product direction; discovery and credential adapters remain implementation work.

The user selected their Mac, using existing sign-ins, for credentialed M0 acceptance. Amun should discover and reuse compatible Pi, Firstmate, Codex CLI, Claude Code CLI and configured MCP servers rather than require duplicate setup. Each reuse path must validate version, transport, permissions and credential support. Detection does not establish compatibility or authorisation to perform an arbitrary external write.

External tool operations (Azure DevOps, Notion, Figma, Canva, Jira, Linear, Cloudflare and future integrations) must use supported APIs or MCP interfaces. Browser UI automation and extracting browser cookies are not integration mechanisms. The browser-view proof remains an embedded browsing capability, not a way to control external tools. Naming a future integration does not expand the current R1 or M0 task scope.

Inventory existing CLI/MCP configuration without logging tokens or copying credentials wholesale. Configuration may contain executable server commands and environment secrets: show a redacted selection/preview before activation, run only explicitly selected trusted servers, and preserve the original configuration. Existing CLI sign-in can be reused via that CLI's supported mechanisms; a credential usable by one tool must not be assumed portable to another. Amun-managed state and permission policy remain separate.

For Azure DevOps, Edge sign-in is not evidence of API authentication. Use a supported authenticated MCP server or an explicit PAT/API connection, with the secret stored through the auth broker. Obtain the test organisation/project and confirm test-write scope before live story/task creation. Never request a PAT in chat.

The user's running Herdr/Pi/Firstmate sessions remain outside Amun's control. Herdr is not an Amun dependency. No repair, restart, lock takeover or upgrade of that personal installation is implied by inventory or by the supplied screenshot.

The user has no Apple account signed in on the machine. Unsigned local development and integration testing can proceed. iCloud login is not the notarization prerequisite: release signing/notarization needs appropriate Apple Developer credentials, which can also be provisioned securely on CI. The T012 release gate remains open; this does not silently waive it.
