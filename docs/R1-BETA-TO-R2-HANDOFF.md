# Amun trusted beta to R2 handoff

The owner requested a trusted tester beta, a fresh local app installation and an R2 continuation. Developer ID signing and notarization are explicitly deferred to the **final step of R2**. The 500 MiB memory budget remains fixed. Do not mark a failed performance gate as passed or infer that the signing deferral waives it.

## Repository and starting point

- Repository: `tamer-sabry8/amun`.
- Canonical checkout: `/Users/tamersabry/Projects/amun`, on `main`; preserve it.
- M6 worktree: `/Users/tamersabry/Documents/ChatGPT/Amun/m6`, branch `feat/m6-hardening-release`, draft PR [#8](https://github.com/tamer-sabry8/amun/pull/8).
- Verified beta source: `7eea589313988756ffe32c378699f413c6c208fd`, clean at build start. Later documentation commits may follow it without changing the packaged code. [Hosted Mac CI](https://github.com/tamer-sabry8/amun/actions/runs/42742690772) passed for that exact commit.
- Read this handoff, `AGENTS.md`, `docs/TASKS.md`, `docs/R1-ACCEPTANCE.md` and `docs/plans/product-and-r1-plan.md` before continuing. Fetch origin, verify the working tree and the beta receipt, and inspect current PR state. Do not assume `main` includes an unmerged M6 branch.
- Create or resume `feat/r2-decision-planning` in `/Users/tamersabry/Documents/ChatGPT/Amun/r2`, starting from the verified M6 beta source when it is not yet on `main`. Keep the source checkout and the M6 evidence intact. Do not merge an incomplete acceptance gate merely to obtain a base branch.

## Beta artifact and installation

The verified DMG is `/Users/tamersabry/Documents/ChatGPT/Amun/releases/Amun-0.1.0-beta-arm64-7eea589.dmg`, with its JSON receipt beside it. SHA-256: `2ab47125a20822191c44ff639b337f911015c5c89cb99ef4c4e1aa3a2ffc7a52`. See [T057](evidence/T057/README.md) for all proof. The target is macOS arm64 for Apple-chip Macs. This build is ad-hoc signed, has no Developer ID identity or notarization, and is for trusted testers. Verification on this Mac does not establish support for every macOS release or Intel Macs.

The owner will install the DMG and try creating a product. Treat that feedback as current evidence. Do not invent a clean-account installation pass or product-owner sign-off. Cleanup is complete: old app data and test artifacts are archived privately at `~/Library/Application Support/Amun-Backups/2026-11-10-before-beta` with mode 0700; nine app/development paths, 724 temporary directories and 1,568 temporary files were moved. Three Amun-owned tmux servers and two owned workers were stopped; four identified Amun credentials were deleted and all other identified targets were already absent. The active app-data folder was absent at cleanup. **Do not repeat cleanup against the owner's new beta data.** Source/evidence, personal profiles and remote test records were preserved. Do not run Firstmate worktrees from an archived profile; restore the original location or validate and repair its Git worktree identity first.

## Verified work and remaining acceptance

T053 chaos and physical sleep/wake, T054 keyboard golden path and T055's 78 visual baselines are closed under the recorded owner decisions. The owner explicitly accepted the composed chaos and ADO batch-recovery evidence for T054. Keep that proof boundary visible; do not reopen the settled approval or claim a same-flow live network interruption.

Source checks passed 515 unit tests after the beta-mode additions. The module-loading checks verify that the proof/gallery, PRD, Monaco and terminal modules stay out of shell startup. PRD and terminal modules load when opened. Three-theme packaged accessibility/keyboard checks and app-owned Keychain persistence across reads, rotation and two restarts passed.

The initial pre-beta broad packaged run passed 56 tests, skipped 23 conditional tests and failed the synthetic conversation-queue journey. Its first failure was model-list startup timeout; an isolated retry missed the local request. The test now waits for the actual model-selected result before entering the streaming step, allows bounded cold resource startup and records bounded fixture diagnostics. Three independent runs then passed in 19.7 seconds. The **final corrected beta run superseded that checkpoint: 57 passed, 23 conditional skips, zero failures in 8.1 minutes**, plus pinned Pi RPC and Firstmate permission/owner checks. Six further DMG-copy tests passed in 31.3 seconds. Normal macOS LaunchServices then rendered the fresh Overview and Connected status on macOS 27.2 arm64. The test app was closed before cleanup.

T056 remains open at **525–530 MiB** in the corrected ad-hoc beta trials, improved from about 588 MiB. The budget is 500 MiB across all five Electron-reported app processes; keep shared-page double counting and excluded external worker memory explicit. All three corrected-beta startup and terminal-echo trials passed; earlier first launches after rebuilding exceeded 3,000 ms. Azure SDK deferral reduced the service entry from about 1.4 MB to 311 KB and its measured process working set from 104 to 90 MiB. PRD typing with local preview, terminal and an explicit synthetic run record measured median 8.3 ms, p95 11.2 ms and maximum 20.1 ms; no earlier editor baseline or separate budget exists. See [T056](evidence/T056/README.md). The signing deferral does not waive memory, and beta delivery is not full M6 sign-off.

## R2 sequence

1. Read the final beta evidence and owner installation feedback. Resolve any remaining T056 failure under the unchanged budget; it is not silently waived or moved by the signing decision.
2. **T059 — Visual roadmap:** initiatives grouped by objective, release and status, editable sequencing and dependency evidence. Label inferred dependencies until confirmed. Preserve product isolation.
3. **T060 — Decision Room:** alternatives, adversarial specialist perspectives, sources, uncertainty and a recorded human decision. Route owner interactions through Firstmate.
4. **T061 — RFP and proposals:** requirements ingestion, compliance matrix and sourced draft sections, preserving review before external publication.
5. **T062 — Integrated R2 acceptance:** TDD, real packaged Mac journeys, regression checks and sanitized evidence. Close acceptance only on actual proof.
6. **R001 — Last step of R2:** obtain the owner's selected Developer ID identity and local protected notarytool profile; sign the app, helpers and native modules; notarize/staple/verify the DMG; perform clean-account installation and signed-update Keychain acceptance. Do not ask for that certificate before this deferred step. The prepared `pnpm release:mac` path must never silently fall back to beta mode. Developer ID release mode retains hardened runtime; ad-hoc beta mode disables it because ad-hoc frameworks have no Developer Team ID. The original beta launch crash was reproduced, corrected and verified before delivery.

The M1 redesign stays paused. Live Google and Obsidian checks stay in R3. Do not add those checks or silently activate future features in the R1 beta.

## Standing decisions and external state

- Reuse the owner's Firstmate and secondmate approvals within the same authorized scope, across retries and restarts. Do not ask the same question again. Changed payload, destination or source head still uses its corresponding exact review.
- Amun-managed Firstmate homes must be real owned Git worktrees. Preserve personal Firstmate, Herdr, Pi and worker sessions/configuration. The bundled snapshot is a pinned runtime, not an operational home.
- Keep one primary Firstmate and product-scoped facts, sources, conversations and pinned decisions. Shared operational preferences do not grant cross-product access.
- Credentials stay in protected service-owned storage. Preserve stable app/helper identities and app-owned Keychain entries through reads, credential rotation, recovery and updates. Delete on explicit disconnect/cleanup. A Node-created test entry does not prove ordinary app behavior.
- The six Azure fixtures `1089414`–`1089419` were assigned to the owner in Sprint 027 and then deleted, with ID-specific verification. Do not recreate or replay them.
- TEST PR [#9](https://github.com/tamer-sabry8/amun/pull/9) was merged into its isolated TEST base, not `main`. Retain its remote branch/PR records under the standing owner preference.
- The exact T054 Notion stakeholder update was published once and independently fetched: [verified synthetic page](https://www.notion.so/4143581de3a981da84d6c8a96ce3b92d). Do not republish it. Notion remains the R1 sharing default through official hosted MCP browser authentication and governed exact-content review.
- Retain the M4 worker-publication/server-denial waiver. A captain publication does not replace a worker check.
- Claude Code 2.1.321 completed isolated, tool-free, nonpersistent inference; Codex CLI 0.163.0 and tmux 3.8 were discovered. Rediscover versions before consequential new acceptance, without restarting personal workers to update them.

## Continuation prompt

> Continue Amun toward R2 using `tamer-sabry8/amun`. First read `docs/R1-BETA-TO-R2-HANDOFF.md`, `AGENTS.md`, `docs/TASKS.md`, `docs/R1-ACCEPTANCE.md` and the product plan from the M6 worktree. Verify the delivered beta receipt, current origin and owner installation feedback. Use a separate R2 worktree. Keep the 500 MiB budget; finish any open T056 proof before claiming the hardening gate complete. Then start T059 and continue through the R2 tracker with TDD and real Mac acceptance. Developer ID signing/notarization is the final R2 step, R001. Reuse settled owner/Firstmate approvals and preserve product isolation, personal sessions, the M4 waiver, the paused M1 redesign and the R3 Google/Obsidian boundary. Update sanitized evidence as each task passes.
