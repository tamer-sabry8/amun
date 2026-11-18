# Amun rebuild, Phase 1: audit and architecture map

Date: 2026-11-18. Branch: `claude/project-thread-3te02r`.

## Executive summary

- The rebuild is feasible without redrawing a single screen. The shipped UI (`apps/renderer`) talks to its backend through exactly one seam: a `MessagePort` delivered by `window.postMessage({ kind: "amun-port" })` (`apps/renderer/src/bridge.ts`). Replacing what sits behind that port lets the whole shell (Roast Room, Agents screens and avatars, dynamic island, left sidebar, right rails, the 6 tiles, all 23 themes) move unchanged.
- Five claims in the brief do not match upstream. The biggest: `.tasks.toml` cannot point at a custom CLI. `tasks-axi` 0.2.6 ships only a markdown backend, so the SQLite board must be a projection of `data/backlog.md`, not a replacement for it.
- "Keep only server, protocol, client, desktop" from Paseo is not possible as stated. `packages/server` imports `@getpaseo/plugin` (20 files), `@getpaseo/cli` (9), `@getpaseo/relay` (5) and `@getpaseo/highlight` (1). Those four must come along as build dependencies. No plugin is installed or enabled at runtime.
- Paseo is Apache-2.0 and Firstmate, Treehouse and tasks-axi are MIT. Their LICENSE files are kept in every vendored copy (see `vendor/VENDORED.md` from Phase 2).
- Three spec items conflict with standing owner rules in this repo's `AGENTS.md`. The plan follows `AGENTS.md` and flags each one (section 5).

## 1. Upstream pins and licenses

| Repo                  | Commit                                                   | Date       | License                                                                                | Verified by               |
| --------------------- | -------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- | ------------------------- |
| kunchenguid/firstmate | `427056c4181c41074ad24f051f79919330df0fa5`               | 2026-11-12 | MIT, (c) 2026 Kun Chen                                                                 | `LICENSE`                 |
| kunchenguid/treehouse | `bd3cc280decabfdadcc5a092aa8f640261e22eb3`               | 2026-11-15 | MIT, (c) 2026 kunchenguid                                                              | `LICENSE`                 |
| getpaseo/paseo        | `b24eab785bee2df459a4f65ddb2165534ff5c054`               | 2026-11-18 | Apache-2.0, (c) 2025-present Mohamed Boudra; third-party parts keep their own licenses | `LICENSE`, `package.json` |
| kunchenguid/tasks-axi | `9401ff899c0d1d8ae6b4fd8727b9025abda2032c` (npm `0.2.6`) | 2026-09-22 | MIT                                                                                    | `LICENSE`, `npm view`     |

Treehouse is a Go binary. Firstmate already installs and calls it (`bin/fm-install-treehouse.sh`, `bin/fm-spawn.sh`). Amun only checks that it is on `PATH`; nothing is vendored.

## 2. Verified upstream facts (claims in the brief checked against source)

| Brief says                                                                  | Upstream reality                                                                                                                                                                                                                                                                           | Status                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 5 Prime Directives                                                          | `AGENTS.md` section 1 "Hard rules" 1-5: never write to a project; never merge without the captain's word; never tear down unlanded work; crewmates never address the captain; report outcomes faithfully                                                                                   | Verified                             |
| `FM_HOME` with `state/ data/ config/ projects/`                             | `AGENTS.md` section 2 and `docs/configuration.md`                                                                                                                                                                                                                                          | Verified                             |
| `FM_ROOT_OVERRIDE`                                                          | Read by `bin/fm-spawn.sh:777` and others as the tracked code root                                                                                                                                                                                                                          | Verified                             |
| `bin/fm-fleet-snapshot.sh` JSON                                             | `--json` (default) prints schema `fm-fleet-snapshot.v1`; other modes `--secondmate-home-summary`, `--contribution-input`, `-h`                                                                                                                                                             | Verified                             |
| `bin/fm-crew-state.sh` JSON output                                          | Not JSON. `fm-crew-state.sh <id>` prints one line: `state: <working\|parked\|done\|blocked\|paused\|failed\|unknown> · source: <...> · <detail>`. The fleet snapshot already embeds it parsed per task (`tasks[].current_state`)                                                           | Brief is wrong; use the snapshot     |
| `bin/fm-captain-hold.sh` "watches inbox"                                    | It watches nothing. Subcommands: `hold <id> --reason`, `answer <id> --decision-file <path> [--release]`, `pr-policy`, `settle-pr`, `answers`, `reconcile-requests`, `bind`, `unbind`                                                                                                       | Brief is wrong                       |
| `state/<id>.inbox/` holds decisions                                         | It is the crew steering inbox written by `fm-send.sh`. Open decisions come from `state/<id>.status` via `fm-classify-lib.sh`, surfaced as `tasks[].hints.open_decisions` in the snapshot. Captain holds are backlog rows with `captain_actionable`                                         | Brief is wrong; use the snapshot     |
| `fm-send.sh --resolve-key <key>`                                            | `fm-send.sh <target> [--resolve-key <key>]... [--fire-and-forget <id>] <text...>`; key charset `A-Z a-z 0-9 . _ -`; refuses unless `FM_HOME` is explicit                                                                                                                                   | Verified                             |
| `bin/fm-spawn.sh --scout`, `--secondmate`                                   | Verified; ship spawns also require `--mode <no-mistakes\|direct-PR\|local-only> --yolo <on\|off>`                                                                                                                                                                                          | Verified                             |
| `bin/fm-brief.sh`                                                           | `<id> <repo> --mode ...`, `<id> <repo> --scout`, `<id> --secondmate {<project>...\|--no-projects}`                                                                                                                                                                                         | Verified                             |
| `.tasks.toml` points to a CLI wrapper                                       | Not supported. `.tasks.toml` selects a tasks-axi backend and paths (`backend = "markdown"`, `[markdown] path/archive/done_keep`). tasks-axi 0.2.6 README: markdown "shipped", sqlite/github/jira/linear "planned"                                                                          | Brief is wrong (see 5.1)             |
| Firstmate needs `tasks-axi`                                                 | Bootstrap requires `tasks-axi >= 0.2.6` with `update --archive-body` and multi-id `mv` (`bin/fm-tasks-axi-lib.sh`)                                                                                                                                                                         | Verified                             |
| Board columns Backlog, Discovery, Spec/Prototype, In Progress, Review, Done | tasks-axi has 3 states only: `## In flight`, `## Queued`, `## Done`, plus `kind`, `hold`, links                                                                                                                                                                                            | 6 columns must be derived (see 5.1)  |
| `config/calm` -> `on`                                                       | Verified (`docs/calm.md`, `docs/calm-mode-feasibility.md`)                                                                                                                                                                                                                                 | Verified                             |
| `config/backend` -> `tmux` or `hc`                                          | Verified; auto-detect order and names in `docs/configuration.md` "Runtime backend"                                                                                                                                                                                                         | Verified                             |
| `config/supervision-effort`                                                 | Does not exist. Real files: `config/supervision-branch-model`, `config/supervision-branch-effort`                                                                                                                                                                                          | Brief is wrong; using the real names |
| `.pi/extensions` auto-load                                                  | `.pi/extensions/` has `fm-branch-supervision.ts`, `fm-calm.ts`, `fm-primary-pi-watch.ts`, `fm-primary-read-repetition.ts`, `fm-primary-turnend-guard.ts`. Pi loads them after project trust is approved once per clone; fallback is `-e` flags (`docs/supervision-protocols/pi.md` step 2) | Verified                             |
| `bin/fm-session-start.sh` on boot                                           | Verified; it runs lock, bootstrap, wake drain and startup network in one digest                                                                                                                                                                                                            | Verified                             |
| Secondmate charter vs `CHARTER.md`                                          | Firstmate writes the charter as `data/<id>/brief.md` via `fm-brief.sh --secondmate`. No `CHARTER.md` is used                                                                                                                                                                               | Verified; none invented              |
| treehouse `get --lease`, `return`                                           | Verified, plus `--lease-holder`, `--json`, `return --if-lease-id`                                                                                                                                                                                                                          | Verified                             |
| Paseo daemon port 6767                                                      | `packages/server/src/server/config.ts:38`                                                                                                                                                                                                                                                  | Verified                             |
| Paseo home path                                                             | `PASEO_HOME` or `~/.paseo` (`packages/server/src/server/paseo-home.ts:15`)                                                                                                                                                                                                                 | Will default to `~/.amun/daemon`     |
| Paseo runs `pi` and `claude`                                                | Providers exist under `packages/server/src/server/agent/providers/` (`pi/`, `claude/`, `codex`, ACP)                                                                                                                                                                                       | Verified                             |
| Paseo `packages/app` deletable                                              | No file in server, client, protocol or desktop imports `@getpaseo/app`                                                                                                                                                                                                                     | Verified                             |

Firstmate also ships its own "Paseo runtime backend" (`docs/paseo-backend.md`): Paseo as a terminal for crews. That is not the banned `gpambrozio/firstmate` plugin, and Amun does not select it. Crews stay on `tmux` or `hc`.

## 3. Proof that the Paseo subset builds

In a scratch copy with `packages/app`, `packages/website` and `packages/expo-two-way-audio` removed from workspaces:

- `npm install --ignore-scripts`: 31 s, exit 0.
- Build order that works: `highlight`, `relay`, `protocol`, `client`, `plugin`, then `server`.
- `tsgo --noEmit` clean for highlight, relay, protocol, client and server.
- Failures to fix in Phase 2: `plugin` `typecheck:examples` needs `@tanstack/react-query` (an app dependency), so examples are dropped; `cli` loses `@types/node` once the app no longer hoists it; `desktop` needs `server` built first.

## 4. Salvage map for `tamer-sabry8/amun`

Baseline at `1b4b82d`: `npm run typecheck` (tsc) passes. Renderer import closure computed from `apps/renderer/src/main.ts`: 124 files reached.

### Keep, moved unchanged

| From                                                                                                                                                                                                                                                                                                                                                                                             | To                                         | Why                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `apps/renderer/src/**` (all 124 reached files, including `rebuild/*`, `island.tsx`, `agents-panel.tsx`, `rebuild/agent-avatar.tsx`, `rebuild/rail.tsx`, `rebuild/screens.tsx`, `rebuild/work-session.tsx`, `rebuild/prd-view.tsx`, `rebuild/prototype-card.tsx`, `rebuild/backlog-view.tsx`, `rebuild/model-picker.tsx`, `tokens.css`, `shell.css`, `rebuild/rebuild.css`, `rebuild/motion.css`) | `packages/amun-ui/src/**`                  | The UI shell. Relative imports to `../../../packages/...` resolve at the same depth, so no import changes |
| `apps/renderer/tests/**`                                                                                                                                                                                                                                                                                                                                                                         | `packages/amun-ui/tests/**`                | Unit tests for the views                                                                                  |
| `apps/desktop/renderer/index.html`, `avatars/` (with `animoon-LICENSE.txt`), `brand/`, `fonts/`                                                                                                                                                                                                                                                                                                  | `packages/amun-ui/public/`                 | Static shell assets                                                                                       |
| `packages/contracts/**`                                                                                                                                                                                                                                                                                                                                                                          | `packages/contracts/**`                    | Message schemas the UI parses. Both UI and new server import them                                         |
| `packages/domain/**`                                                                                                                                                                                                                                                                                                                                                                             | `packages/domain/**`                       | Pure view logic (shell, agents, home, planning, council, blockers, RICE). Only `node:crypto`              |
| `packages/theme/**`, `tokens/*.json`, `scripts/build-tokens.ts`                                                                                                                                                                                                                                                                                                                                  | same                                       | Themes stay exactly as today                                                                              |
| `packages/crew/src/native-pi-login.ts`                                                                                                                                                                                                                                                                                                                                                           | `packages/domain/src/native-pi-login.ts`   | The only crew file the UI imports; pure                                                                   |
| `packages/pi-bridge/src/gate.ts`                                                                                                                                                                                                                                                                                                                                                                 | `packages/contracts/src/pi-bridge-gate.ts` | The only pi-bridge file contracts import; pure                                                            |
| `AGENTS.md`, `docs/**`                                                                                                                                                                                                                                                                                                                                                                           | same                                       | Owner rules and history                                                                                   |

### Kept in the UI but test-only (unchanged behaviour)

`shell.tsx` (legacy shell, `?legacy=1`), `proof.ts`, `proof-markup.ts`, `gallery.tsx`. `AGENTS.md` says the legacy shell must not ship; `shell-selection.ts` already blocks it in packaged builds.

### Dead in the UI today (not reached from `main.ts`)

`control-tower-view.tsx`, `operations-view.tsx`, `org-goals-view.tsx`, `trajectory-view.tsx`, `widget-host.tsx`. Moved with the rest so nothing visible changes; candidates for a later clean-up.

### Delete (old agent-spawning and backend code)

| Path                                                                                                      | Lines  | What it did                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/**`, `apps/desktop/vite.*.ts`, `forge.config.cjs`, `apps/desktop/tests/**`              | 14,630 | Electron main, Pi runtime, delegation, crew spawning, browser, ADO/GitHub ops                                                                     |
| `apps/service/**`                                                                                         | 2,438  | Old service process                                                                                                                               |
| `packages/crew/**` (except the file above)                                                                | 11,762 | Custom crew spawning and Herdr/tmux control                                                                                                       |
| `packages/pi-bridge/**` (except gate)                                                                     | 316    | Pi RPC bridge                                                                                                                                     |
| `packages/data/**`                                                                                        | 26,192 | Old SQLite work store (`better-sqlite3`)                                                                                                          |
| `packages/council/**`                                                                                     | 1,966  | Roast Room runtime (spawns advisors with `child_process`). The Roast Room screens stay; the council flow is re-hosted behind the new server later |
| `packages/auth/**`, `packages/security/**`, `packages/hosting/**`                                         | 6,914  | Keychain and hosting glue tied to the old service                                                                                                 |
| `packages/connectors-ado/**`, `packages/connectors-notion/**`                                             | 2,924  | Tied to `packages/data` and `@napi-rs/keyring`. Recoverable from `main`                                                                           |
| `runtime/**`, `scripts/*-proof.*`, `scripts/stage-*.ts`, `scripts/prepare-runtime.ts`, `scripts/*-mac.ts` | 4,124  | Staging for the old bundled runtimes                                                                                                              |
| `tests/e2e/**`                                                                                            | 11,004 | Playwright journeys against the old Electron main                                                                                                 |

Everything deleted stays in `main` history. Nothing on `main` is touched.

## 5. Decisions and pushback

### 5.1 Backlog engine: project the markdown backlog, do not replace it

Weakest point of the brief. Firstmate's own scripts (`fm-spawn.sh`, `fm-teardown.sh`, `fm-captain-hold.sh`, `fm-backlog-handoff.sh`) call `tasks-axi` directly and probe its version and flags. A shim named `tasks-axi` would have to match 0.2.6 byte-for-byte on the markdown round-trip, or Firstmate refuses lifecycle work. So:

- `data/backlog.md` stays the source of truth that Firstmate writes through real `tasks-axi`.
- `packages/server` watches it and projects rows into `$FM_HOME/data/amun-pm.db` (`node:sqlite`), where Initiatives, 4-Question fields, Roadmaps and Sprints live.
- `bin/amun-tasks-axi` is Amun's own CLI. It calls real `tasks-axi` for any change to the backlog and writes Amun-only fields to SQLite. Firstmate never calls it.
- The 6 board columns are derived: Queued + `kind: SCOUT` = Discovery; Queued + spec/prototype kind = Spec / Prototype; other Queued = Backlog; In flight = In Progress; In flight with a PR link or a captain hold = Review; Done = Done.

### 5.2 Holds go through the First Mate, not straight to the crew

The brief's reply box calls `fm-send.sh --resolve-key` directly. `AGENTS.md` (owner, 15 Nov 2026) says: "do not let the UI bypass Firstmate to talk to crew". The default path sends the captain's answer to the First Mate session, which runs `fm-send.sh` or `fm-captain-hold.sh answer` itself. A direct path exists in the server for later use, off by default.

### 5.3 UI: preserve, do not redesign

`AGENTS.md` requires owner approval, with a side-by-side preview, before any UI change, and says the reference HTML's colours "are not selected". Tamer's last paragraph also says keep the UI and themes as they are. So:

- The 5 surfaces are fed into the screens that already exist: Product Spaces into the left sidebar groups, the fleet into the Agents screen and avatars, captain holds into the dynamic island and the amber conversation card, the board into Sprints, prototypes into the existing prototype card and browser preview, PRD into `prd-view.tsx`, and provider into the model picker in the prompt box (the one owner-approved composer addition).
- The brand palette (`#0A1128`, `#F59E0B`, `#D4AF37`) is added as an opt-in token theme. It does not replace the default `tamer-sabry-default`.
- Any surface that has no existing screen (for example a separate quota pill) is built as a preview for approval, not shipped.

### 5.4 Product Space homes must be real Git worktrees

`AGENTS.md` (owner, 6 Nov 2026): "Amun-managed Firstmate homes must be real Git worktrees backed by an Amun-owned Git repository." `~/.amun/homes/<slug>` is therefore a `git worktree` of an Amun-owned bare repo at `~/.amun/homes.git`, not a plain folder.

### 5.5 Package manager

Paseo is an npm-workspace monorepo with a lockfile; Amun used pnpm. The brief's gate is `npm run typecheck`, so the root becomes npm workspaces. Node: Amun pinned `>=24.22.1`, Paseo works on the installed 22.23. `node:sqlite` is available in both.

### 5.6 Linear and Jira

Adapters are built and unit-tested against recorded payloads. No live call is made until Tamer provides credentials.

## 6. Target layout (Phases 2 to 4)

```
vendor/firstmate/        Firstmate @427056c, untouched git subtree (playbook moved to firstmate-layer/)
vendor/VENDORED.md       pins, licenses, local patches
packages/protocol/       Paseo, plus amun-rpc.ts (fleet, holds, backlog, spaces payloads)
packages/client/         Paseo DaemonClient
packages/server/         Paseo daemon on 6767, home ~/.amun/daemon, plus src/amun/ (spaces, FM_HOME bootstrap, primary session, RPC, PM store, sync)
packages/desktop/        Paseo Electron shell rebranded ai.transfrm.amun, loads amun-ui
packages/plugin, cli, relay, highlight/   Paseo build dependencies of server (no plugins enabled)
packages/amun-ui/        the current Amun renderer, moved unchanged, plus a WebSocket port adapter
packages/contracts, domain, theme/        kept from Amun
bin/amun-tasks-axi       Amun CLI over real tasks-axi plus amun-pm.db
```
