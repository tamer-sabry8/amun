# Handoff: the 500 MiB memory budget on the packaged app

13 November 2026. Written for an agent with no knowledge of the earlier work.

Full detail is under item 7 in [docs/6-issues.md](6-issues.md); the new code is [graphics-mode.ts](../apps/desktop/src/graphics-mode.ts) and [graphics-fallback-proof.ts](../scripts/graphics-fallback-proof.ts).

## The problem in one paragraph

Amun is an Electron 45.2.3 desktop app (React 19, TypeScript, pnpm workspace). The trusted-tester beta has a fixed budget: the packaged app must use at most **500 MiB**, measured as the working set summed across every process Electron reports, at the first screen and on Home. With the normal five processes Amun measures 525–528 MiB at the first screen and 549 MiB on Home, so it fails. No fix was found that keeps five processes. As a fallback the app now runs graphics inside the main process (four processes), which measures 459–482 MiB at the first screen and 482–501 MiB on Home. That is at the limit, not safely under it, and it has a cost: a graphics failure closes the whole app.

## What you are asked to do

Get the packaged app reliably under 500 MiB with real margin, without the cost of in-process graphics if you can, and without breaking the rules below. If you cannot remove in-process graphics, make its margin real (target: Home at or below about 485 MiB on every launch) and keep the crash fallback working.

## Rules you must keep

These come from `AGENTS.md` and the owner's instructions. Read `AGENTS.md` first.

- The 500 MiB budget is fixed. Do not raise it, do not exclude a process from the sum, do not claim a pass or a waiver that the measurement does not show. Report the actual numbers.
- Do not weaken the approval gates, process isolation, Keychain handling or data-integrity checks to pass a test. This includes the message validation between the service and the window.
- Use throwaway profiles only (`--user-data-dir=<temp folder>`). Never use or modify the owner's personal Firstmate, Herdr or Pi homes, sessions, locks or configuration. Never enter credentials.
- Do not switch or reset the owner's checkout. Work in an isolated worktree.
- The beta is ad-hoc signed for Apple-chip Macs. Do not claim notarization or public-release readiness.
- Do not start T022c without the owner's approval.
- Commit, push or open a PR only when the owner asks.

## How to build and measure

```bash
pnpm install
pnpm check                                   # lint, types, unit tests, format
pnpm package                                 # full package (stages runtimes first; slow)
pnpm --filter @amun/desktop package          # faster repackage after a full one
node scripts/rebuild-performance-proof.ts    # the memory and startup proof
node scripts/graphics-fallback-proof.ts      # the crash-fallback proof and soak
pnpm exec playwright test tests/e2e/rebuild-shell.spec.ts
AMUN_LEGACY_SHELL=1 pnpm exec playwright test tests/e2e/m1-shell.spec.ts tests/e2e/m1-requests.spec.ts tests/e2e/m2-products.spec.ts tests/e2e/m5-portfolio.spec.ts
```

The packaged app is `apps/desktop/out/Amun-darwin-arm64/Amun.app`.

`scripts/rebuild-performance-proof.ts` launches the packaged binary three times in fresh profiles. It waits for the first setup screen, samples `app.getAppMetrics()` (sum of `memory.workingSetSize`), clicks Continue three times and "Finish setup", waits for "Welcome to Amun" plus 1.5 s, and samples again. It exits 1 if any launch exceeds 3,000 ms startup or 500 MiB at either sample. Do not change the sampling points or the wait to get a better number.

To compare with five processes, launch with `--amun-separate-graphics` or `AMUN_SEPARATE_GRAPHICS=1`.

## Root cause

The method adds up each process's working set, and each process counts Electron's own shared framework code again. Measurements on this Mac:

| What                                                                                | Total       | Main                        | Graphics | Network | Window  | Helper/service |
| ----------------------------------------------------------------------------------- | ----------- | --------------------------- | -------- | ------- | ------- | -------------- |
| Empty Electron app, one blank 1200×800 window, one idle helper (`ps` resident size) | 437 MiB     | 159                         | 78       | 47      | 85      | 66             |
| Same empty app measured through the Playwright proof harness                        | 457 MiB     | 168                         | 78       | 48      | 97      | 66             |
| Amun, five processes, first screen                                                  | 525–528 MiB | 171                         | 90       | 48      | 126–128 | 93             |
| Amun, five processes, Home                                                          | 549–553 MiB | 173–176                     | 95       | 49      | 139     | 94             |
| Amun, in-process graphics, first screen                                             | 459–482 MiB | 191–210 (includes graphics) | —        | 48      | 127     | 93             |
| Amun, in-process graphics, Home                                                     | 482–501 MiB | 201–219 (includes graphics) | —        | 49      | 138–140 | 94             |

So an empty Electron app already uses 437–457 MiB of the 500 by this method. Amun's own share is about 70 MiB at the first screen and 95 MiB on Home. Passing with five processes means cutting more than half of everything Amun itself uses.

For scale, macOS's own "physical footprint" (`vmmap --summary`, shared pages counted once) is about 100 MiB for the empty app and 163 MiB for Amun. That figure is informative only; it is not the budget's method.

Where Amun's own memory goes (five processes, over the empty app):

- **Window process, about +30 at first screen and +42 on Home.** Measured bundle by bundle in an empty app: stylesheet and fonts +5, React and icons +5, app code +3, rendering the first screen +11, and **the validation library (zod 4.6.7) with the contract schemas +14**.
- **Service process, about +27.** Traced step by step: 70 MiB before any code runs, 84 after its imports are evaluated (+14, the shared schema and validation chunks), 88 after opening the workspace database (+4), 93 a few seconds later. An empty helper with the database open is 73. Its script heap is only 10 MiB.
- **Graphics, about +12 to +17.** Window content. The new shell's stylesheet has no backdrop filters or forced layers.
- **Main process, about +3 to +8.** Its bundle is 20 KB.

## Everything that was tried

### Before this work (recorded in `docs/evidence/T056/README.md`)

The earlier shell went from 588 MiB to 525–530 MiB through deferred loading of the editor, MCP SDK, GitHub client and Azure SDK. Two experiments were rejected there: software rendering (worse, 575–619 MiB) and a V8 optimize-for-size flag (no gain, 544–553 MiB).

### Reductions that were kept (five processes: 534–551 / 558–574 MiB → 525–528 / 549 MiB)

- `apps/renderer/src/rebuild/lazy.tsx`: Settings, Agents panel, Backlog and the native Pi panel load on demand (`React.lazy` with a Suspense fallback).
- `apps/renderer/src/auth-prompt-view.tsx`: the sign-in prompt was moved out of `shell.tsx` so the new shell no longer pulls in the earlier shell's code.
- `packages/council/src/service.ts`: the 1.5 s poll returns early when the Chair has no pending question, instead of building a snapshot each time.
- `apps/renderer/src/rebuild/app.tsx`: Council status is requested only on the Council and Settings screens.

### Launch switches that did not help

On the packaged app with five processes:

- `--enable-low-end-device-mode`: no benefit.
- Disabling the spare renderer: no benefit.
- `--force-device-scale-factor=1`: no benefit.
- `--disable-gpu-rasterization`: worse, 575–588 MiB.
- `--js-flags=--max-semi-space-size=1`, `=2`, `=4` and `--js-flags=--semi-space-growth-factor=1`: no change (Home 484–486 in every case, in-process mode).

On the empty Electron app (floor 437 MiB):

- `--disable-features=SkiaGraphite`: 446 MiB.
- `--use-angle=gl`: 459 MiB.
- `--num-raster-threads=1`: 450 MiB.
- `--disable-features=PartitionAllocBackupRefPtr`: 434 MiB. Not worth it, and it removes a memory-safety hardening.
- `--disable-gpu-shader-disk-cache --disable-background-networking --disable-component-update --disable-breakpad`: 448 MiB.

### Investigations that found nothing to cut

- **Service native modules.** In an empty helper: Node built-ins +2, the database module with an open database +5, the Keychain module +3. None is optional.
- **Service code.** Loading each built chunk alone showed the cost is the shared schema and validation chunks that everything depends on.
- **Window layers.** No `backdrop-filter`, `will-change` or forced 3D layers in `apps/renderer/src/rebuild/rebuild.css`.
- **Main process.** Script heap 6.5 MiB.
- **Leak check.** After 280 screen changes the total rises (646 MiB with five processes, 578–592 in-process), but script heap after garbage collection stays near 6 MiB with constant element and listener counts. The window's working set levels off near 180 MiB. This is growth with use, not a leak, and the budget is measured at launch.

### The one sizeable item, deliberately not changed

zod with the contract schemas costs about 14 MiB in the window and a similar share of the service. In an empty page: zod core alone +24 unbundled, +14 as bundled and tree-shaken, and about +10 more per 300 object schemas. It validates every message between the service and the window (`apps/renderer/src/bridge.ts`, `apps/renderer/src/rebuild/store.ts`, `packages/contracts/src/*.ts`). Removing or thinning those checks to pass a memory test is against the rules above. Replacing zod with a lighter validator that performs the same checks is allowed in principle but touches every contract. Estimated effect: five-process Home at 520–535 MiB (still over), in-process Home at roughly 470.

## What was built: in-process graphics with a crash fallback

`apps/desktop/src/graphics-mode.ts` (pure rules plus a small file read/write) and `chooseGraphics()` in `apps/desktop/src/main.ts`, which runs after the single-instance lock is taken and before the app is ready.

- It keeps `graphics-mode.json` in the profile: `{ version, mode, running, failures }`.
- Default: append Chromium's `in-process-gpu` switch.
- `running` is written `true` at launch and `false` on the app's `quit` event.
- If the previous launch was in-process and did not exit cleanly, this launch uses the separate graphics process and `failures` goes up by one.
- The launch after that tries in-process again. A clean in-process exit resets `failures` to 0.
- At `failures >= 2` the app stays on the separate process for that app version. A new version starts fresh.
- `--amun-separate-graphics` or `AMUN_SEPARATE_GRAPHICS=1` forces the separate process without recording a failure.
- An unreadable or malformed record is treated as a first launch.

A force-quit or power cut also counts as unclean. It costs one launch in the separate process (about 549 MiB on Home).

## Test results on the packaged app

| Check                                         | Result                                                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory proof, six runs of three launches      | Four runs passed. The first two, straight after packaging, failed: both had a Home reading of 501 MiB, and the first also had a 4,395 ms startup. The last nine launches read 484–488 MiB |
| Fallback, six launches with two kills         | Mode switched as designed at every step                                                                                                                                                   |
| Soak, 280 screen changes with resizes         | No crash; median frame 8.3 ms; no frame over 50 ms                                                                                                                                        |
| Rebuild journey and four earlier-shell suites | Pass                                                                                                                                                                                      |
| Unit tests, lint, types                       | 938 pass, including 9 for the fallback rules                                                                                                                                              |

All eighteen proof launches, Home in MiB, in order: 488, 499, 501 / 500, 484, 501 / 485, 482, 499 / 487, 488, 487 / 485, 484, 486 / 486, 485, 486. First-screen readings ranged 459–482. Startup was 319–445 ms apart from the one 4,395 ms launch.

Smoothness compared with five processes (measured before the fallback was built, by launching with the switch): frame time median 8.3 ms in both modes; worst about 10 ms, with one isolated 182 ms hitch in one of four in-process runs; terminal echo 25–27 ms against 25–26; editor typing 95th percentile 9.1–9.4 ms against 9.2–9.7.

## What failed, and why

1. **Five processes fail the budget** (525–528 / 549 MiB) because the empty-Electron floor is 437–457 MiB by this method.
2. **Two of six in-process proof runs failed.**
   - Home read 501 MiB in two launches. On some launches the main process holds about 15 MiB more on Home (213–219 MiB instead of 201–205). The suspected cause is one extra window-sized graphics buffer kept after the setup screens (a 1200×800 window at 2× scale is about 15 MiB per buffer). This is not confirmed. The readings held steady over 20 s, so it is not a transient.
   - The first launch after packaging took 4,395 ms against the 3,000 ms startup budget. Earlier records show the same slow first launch for a freshly built package (9–12 s at times); later launches are 319–445 ms. A truly cold launch was not measured.
3. **A graphics failure in in-process mode closes the whole app.** With five processes the app carries on and graphics restart within seconds. The fallback only protects later launches. A real in-process graphics failure could not be triggered other than by killing the app, so its frequency on tester Macs is unknown.
4. **Memory after use is over 500 MiB in either mode** (592 MiB after the soak at 1440×900).
5. **`tests/e2e/m6-accessibility.spec.ts` (earlier shell) fails intermittently** with `ENOTEMPTY ... firstmate-home-.../distribution` during temp-folder cleanup. Its accessibility assertions pass. It fails the same way with the memory changes reverted, so it comes from the test's teardown (`rm` without retries) after fresh runtime staging. Not fixed.
6. **Not run:** the full `pnpm test:packaged` suite (most of its journeys drive the earlier shell), and any launch with a signed-in model or running agents.

## Ideas not yet tried

- Confirm what the extra ~15 MiB on Home is (compare `vmmap --summary` of the main process between a 485 and a 500 launch) and whether the setup-to-Home transition can avoid it.
- Measure a returning user's launch straight to Home; the proof always goes through the four setup screens first.
- Replace zod in the window with a lighter validator performing the same checks, or construct contract schemas lazily so only the ones used at startup exist.
- Split the service's schema chunk so rarely used contracts load on first use.
- Minify the window bundle (Vite's ES library build leaves it unminified, about 1.1 MB of source at startup). Expected gain is small, around 1 MiB.
- Drop the earlier shell's stylesheet (`shell.css`, 1,334 lines) from the new shell where its classes are not used by embedded earlier views.

## Where things are

| Path                                                                            | What                                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `docs/6-issues.md`                                                              | All seven open issues; item 7 is this one, with the full record |
| `docs/evidence/T056/README.md`                                                  | Earlier memory work on the earlier shell                        |
| `docs/UX-REBUILD.md`                                                            | What the rebuild switched off and how to restore it             |
| `apps/desktop/src/graphics-mode.ts`, `apps/desktop/tests/graphics-mode.test.ts` | Fallback rules and their tests                                  |
| `apps/desktop/src/main.ts`                                                      | `chooseGraphics()`, window and service start                    |
| `apps/desktop/src/service.ts`                                                   | The service process (2,192 lines)                               |
| `apps/renderer/src/rebuild/`                                                    | The new shell (shell v3)                                        |
| `scripts/rebuild-performance-proof.ts`                                          | Memory and startup proof                                        |
| `scripts/graphics-fallback-proof.ts`                                            | Fallback proof and navigation soak                              |
| `scripts/performance-proof.ts`                                                  | The earlier shell's proof (run with `--amun-legacy-shell`)      |
