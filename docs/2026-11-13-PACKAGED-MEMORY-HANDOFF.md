# Amun packaged memory fix · 13 November 2026

PR #17 merged into `tamer-sabry8/amun` at `36f4756786f8f4e1f2e3c9fbbdd5d184ca2d56cf`. Integrate that commit into your feature branch. On the measured Apple-chip Mac, all 36 default launches met the fixed 500 MiB memory budget. Home peaked at 481 MiB. The 3,000 ms startup gate remains open. [Merged PR](https://github.com/tamer-sabry8/amun/pull/17) · [Per-launch evidence](evidence/T056/rebuilt-memory-margin.json)

## What to preserve during the merge

- **Service startup.** In `startService()`, Electron forks the Amun utility process with `execArgv: ["--js-flags=--max-opt=1"]`. This caps the service’s JavaScript compilation at V8’s baseline tier to reduce generated code. Retain the integration branch’s service environment and process isolation. [Service launch](https://github.com/tamer-sabry8/amun/blob/36f4756786f8f4e1f2e3c9fbbdd5d184ca2d56cf/apps/desktop/src/main.ts#L53-L65)
- **Window creation.** In `openWindow()`, resolve the shell before constructing the window. The normal rebuilt shell starts visible with its initial canvas color, `#0b0e14`, and receives the same V8 cap through `webPreferences.additionalArguments`. In testing, painting the rebuilt shell first in a hidden window and then calling `show()` produced higher peak working sets. The cause of the roughly 15 MiB variation was never established. The earlier shell, proof view and development gallery keep their hidden-until-`ready-to-show` path. Embedded web previews keep their own preferences. If your branch adds a route, preserve its intended startup behavior when reconciling `shellQuery`. [Window creation and routing](https://github.com/tamer-sabry8/amun/blob/36f4756786f8f4e1f2e3c9fbbdd5d184ca2d56cf/apps/desktop/src/main.ts#L190-L251)
- **Graphics recovery and validation.** The in-process GPU default and recovery logic already existed at the PR base, `e03febb`. An unclean in-process exit selects a separate GPU on the next launch. Two accumulated unclean in-process exits keep that app version on separate graphics. A clean in-process exit resets the count. A GPU failure can still terminate the current in-process launch. Preserve these rules, renderer sandboxing, Zod message validation, approval gates and service-owned Keychain handling. [Recovery implementation](https://github.com/tamer-sabry8/amun/blob/36f4756786f8f4e1f2e3c9fbbdd5d184ca2d56cf/apps/desktop/src/graphics-mode.ts)
- **Packaged journey.** The CI follow-up uses exact accessible names for “Hand to delivery” and “Open delivery project”. A substring lookup could also match the RFP tile. Keep the disabled-state check before the approvals and the successful handoff assertion afterward. [Test correction](https://github.com/tamer-sabry8/amun/commit/b86e042e009f6399074e436d31b1265bc9e3eaf0)

## Integrate into your branch

Read the repository’s [AGENTS.md](../AGENTS.md). Work in your feature branch’s isolated worktree. Check the branch and working tree before merging, and preserve any in-progress edits.

```sh
git status --short --branch
git fetch origin main
git merge-base --is-ancestor 36f4756786f8f4e1f2e3c9fbbdd5d184ca2d56cf HEAD
```

Exit code 0 means the commit is already in your history. Inspect the current launch code in case later edits changed its behavior. Exit code 1 means the commit is missing. From your feature branch, integrate it with:

```sh
git merge 36f4756786f8f4e1f2e3c9fbbdd5d184ca2d56cf
```

If both branches changed `main.ts`, resolve the affected blocks individually so your branch’s features survive. The history contains the runtime fix and measurements in `1297fd1`, followed by the packaged-test correction in `b86e042`. [Complete PR diff](https://github.com/tamer-sabry8/amun/pull/17/files)

## Verify your combined build

On an Apple-chip Mac, use the repository’s pinned toolchain. Use disposable profiles for every app launch, leave personal Firstmate, Herdr and Pi homes untouched, and keep the journey signed out. The package below uses ad-hoc beta signing.

```sh
pnpm install --frozen-lockfile
pnpm check
AMUN_BETA=1 pnpm package
node scripts/rebuild-performance-proof.ts
node scripts/graphics-fallback-proof.ts
AMUN_PACKAGED_PATH="$PWD/apps/desktop/out/Amun-darwin-arm64/Amun.app/Contents/MacOS/Amun" \
  pnpm exec playwright test tests/e2e/rebuild-shell.spec.ts
```

Run the memory proof first after packaging. Record that first startup even when it fails. Each invocation does three launches. Repeat across fresh profiles to check for the intermittent high readings. The proof samples the first setup screen and Home 1.5 seconds after “Welcome to Amun”, summing every process reported by `app.getAppMetrics()`. For a separate-GPU comparison, pass `--amun-separate-graphics` to the Electron child in a diagnostic copy of the proof and verify that the metrics include a GPU process. The harness supplies its own child environment. [Proof and sampling points](../scripts/rebuild-performance-proof.ts)

| Measured on PR #17                               | Setup       | Home        |
| ------------------------------------------------ | ----------- | ----------- |
| Default graphics, 36 fresh profiles              | 454–463 MiB | 454–481 MiB |
| Three returning profiles opened directly to Home | —           | 460–461 MiB |
| Forced separate graphics, three fresh profiles   | 521–526 MiB | 545–547 MiB |

Default Home median was 479 MiB. The first launch after signing took 6,707 ms, compared with 7,000 ms on the base build. The other 35 launches took 345–415 ms. Eleven of twelve batches passed the combined memory and startup proof. The six-launch crash-fallback proof passed. The 280-screen-change soak ended at 616 MiB with zero renderer crashes. These results cover launch memory on this Mac with no signed-in model or running agents. Report your combined branch’s measurements separately. [Measurement record](evidence/T056/rebuilt-memory-margin.json)

Local verification passed 938 unit tests and nine targeted packaged regressions. Hosted CI also passed the packaged suite on the final PR head, `b86e042`. [Final GitHub Actions run](https://github.com/tamer-sabry8/amun/actions/runs/43391141233)
