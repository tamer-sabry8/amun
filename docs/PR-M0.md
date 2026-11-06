# M0: isolated desktop and live Mac foundation proofs

Adds the sandboxed Electron shell, recoverable service process, pinned Pi/Firstmate runtimes, and isolated browser and terminal proofs. Existing personal sessions and installations remain separate. This is the M0 foundation shell, not the finished Amun UI.

## Implemented and verified

- Typed service RPC, bounded Pi JSONL/request handling and validated dialog replies; packaged OpenRouter and GitHub Copilot inference through Pi with empty PATH and isolated state. Personal credential file remained unchanged.
- Checksum-pinned Firstmate distribution, restrictive managed-home settings and private tmux scope. Real source/packaged Pi lock ownership and fresh watcher heartbeat pass using the documented CLI RPC entry.
- Sandboxed WebContentsView with strict URL/navigation and permission policy. Real local prototype/redirect/security E2E proves no Node, IPC or Amun port access.
- Service-owned node-pty and renderer xterm: explicit control, read-only default, bounded input/output and resize. Native runtime is rebuilt for Electron and contained in the unsigned package.
- API-only Azure DevOps proof using Keychain PAT: ICV Test PBI #1088026 and Test Task #1088027, revision-checked updates, and real HTTP 412 stale-revision rejection. No Azure browser integration.

## Validation

145 unit tests, lint, strict typecheck and formatting pass locally on macOS arm64 with Node 24.22.1 / pnpm 11.25.0. Four source Electron E2E tests pass. Packaged validation and detailed live results are recorded in docs/evidence by task. CI rebuilds the source terminal for Electron before E2E.

Three process-cold launches with warm caches measured 713/502/324 ms to Connected, summed Electron working set 481/481/480 MiB and proof-terminal echo 16/22/13 ms. These are a local baseline, not clean-account or release acceptance; see ADR-008.

## Open exit gates

M0 remains incomplete. T006 needs service/UI stream and dialog integration. T007/T008 need safe worker permission propagation, wake/recovery and ten real worker reattachment trials. T010 needs an allowed authenticated site. T011 needs backend attachment and Finder acceptance. T012 needs clean-account installation and real Apple signing/notarization credentials/evidence. T009 is complete; other open gates are not waived. No M1/M2 work or automatic merge.
