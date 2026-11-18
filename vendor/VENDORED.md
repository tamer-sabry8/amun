# Vendored and imported upstream code

| Path | Upstream | Commit | License | Local changes |
| --- | --- | --- | --- | --- |
| `vendor/firstmate/` | https://github.com/kunchenguid/firstmate | `427056c4181c41074ad24f051f79919330df0fa5` | MIT (`vendor/firstmate/LICENSE`) | Added `AMUN_PM_PLAYBOOK.md`; added section 15 to `AGENTS.md` pointing to it. Nothing else changed. |
| `packages/{protocol,client,server,desktop,plugin,cli,relay,highlight}/` | https://github.com/getpaseo/paseo | `b24eab785bee2df459a4f65ddb2165534ff5c054` | Apache-2.0 (`packages/PASEO-LICENSE`, plus each package's `LICENSE`) | See "Paseo patches" below. `packages/app`, `packages/website`, `packages/expo-two-way-audio`, root `plugins/` and `skills/` are not imported. |

Not vendored, required on the host `PATH`: `treehouse` (MIT, https://github.com/kunchenguid/treehouse, installed by `vendor/firstmate/bin/fm-install-treehouse.sh`), `tasks-axi >= 0.2.6` (MIT, `npm install -g tasks-axi`), `tmux` or `herdr-core`, `jq`, `git`.

## Paseo patches (Apache-2.0 section 4(b): modified files carry a note)

- `server/src/server/paseo-home.ts`: default home `~/.amun/daemon` (or `$AMUN_HOME/daemon`); `PASEO_HOME` still wins.
- `server/src/server/config.ts`: the public relay is off unless explicitly enabled (local-first). `config-relay.test.ts` updated to match.
- `server/src/server/bootstrap.ts`: `mcp.injectIntoAgents` defaults to off (Firstmate dispatches workers, never Paseo MCP); mounts Amun RPC on `/amun` via `server/src/server/amun/attach-amun.ts`.
- `server/src/server/websocket-server.ts`: the `/ws` WebSocket server uses `noServer` plus an explicit path filter so `/amun` can share the HTTP server.
- `server/src/server/plugins/builtin/index.ts`: the built-in plugin list is empty. Amun ships zero Paseo plugins.
- `server/package.json`: dropped the `@getpaseo/builtin-plugins` dependency; the build no longer copies root `skills/` and `plugins/`.
- `plugin/package.json`: `typecheck` no longer checks the plugin examples (they need the deleted app's React Query).
- `protocol/src/amun-rpc.ts`: new, additive Amun RPC schemas.

### Phase 4 additions

- `packages/server/src/server/websocket-server.ts`: the `/ws` upgrade router only attaches to a real HTTP server (`instanceof EventEmitter`), so Paseo's stubbed unit tests keep passing.
- `packages/server/src/server/hub/test-utils/relationship-harness.ts`: opts into `mcpInjectIntoAgents` explicitly, since Amun defaults it off.
- `packages/desktop`: appId `ai.transfrm.amun`, productName/executable `Amun`, renderer from `packages/amun-ui/build`, `vendor/firstmate` bundled as `resources/firstmate` and passed to the daemon as `AMUN_FIRSTMATE_ROOT`.
- `tsconfig.base.json` copied from Paseo's root (desktop and cli extend it).
