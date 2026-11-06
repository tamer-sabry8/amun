# Real owned watcher on the local Mac

The first ownership probe exposed a real mismatch: Pi’s RPC-only entry sets process.title to pi-rpc, which the pinned Firstmate ancestry classifier does not recognise as the intended Pi session. fm-lock.sh reported acquisition but its recorded PID was not the launched Pi PID. This failed the acceptance assertion; acquisition output alone was not accepted.

Use the documented bundled `dist/bundle/cli.js --mode rpc` entry for Firstmate sessions. Pi’s setupCli sets its normal pi process identity; the same supported fm-lock.sh command now records the exact launched Pi process in both source Node and packaged Electron-as-Node execution. No installed source, personal lock, classifier, or lock file was patched or forged.

The authored test extension calls only the supported lock command inside a disposable managed home. The subsequent registered /fm-watch-arm-pi command starts real supervision. A live watcher PID and a fresh .last-watcher-beat were observed in both source and packaged execution. Without the arm command the owned-watcher check fails (owned-watcher-red.log). Both successful runs had zero worker dispatches and zero model turns.

Shutdown closes Pi’s stdin for its normal session shutdown, then invokes fm-watch-arm.sh --stop with exactly the disposable home’s environment; no unscoped process cleanup occurs. This proves ownership and initial watcher operation. It does not yet prove actionable wake consumption, watcher recovery, secondmate permission propagation, authenticated worker dispatch or persistent reattachment. T007 and T008 remain open.

## Supported stop/rearm recovery

The `--watch --recover` probe first failed with `recovered:false` (adjacent red log). It now invokes the pinned home-scoped `fm-watch-arm.sh --stop`, asks the same owned Pi session to run `/fm-watch-arm-pi`, and requires a different live watcher PID, fresh heartbeat, and unchanged Pi ownership PID. Source and packaged runs pass with zero worker dispatches and zero model turns. Cleanup uses the same home-scoped stop path. This proves explicit stop/rearm recovery, not crash-triggered automatic recovery, wake delivery, or worker reconnection.

## Worker permission blocker

Read-only inspection of pinned `bin/fm-config-inherit-lib.sh` line 96 shows that the inherited item set includes `claude-permission-mode` and `codex-approval-mode`, but omits `codex-permission-mode`. The documented environment override is test-only. Setting restricted mode only on the primary is therefore insufficient evidence for secondmate workers. Worker dispatch remains gated pending an Amun compatibility implementation and live propagation proof. No personal installation was patched or upgraded.

## Git worktree and import continuation

The owned-watcher script now provisions an actual Git worktree from the pinned snapshot. Source and packaged runs still prove exact Pi lock ownership, live watcher/heartbeat and explicit stop/rearm recovery. Actionable wake consumption and automatic crash recovery remain unproven.

Read-only inspection of the existing Mac Firstmate checkout found no additional untracked skill files. A disposable real Amun worktree imported crew-dispatch.json and secondmate-harness literally, kept the user's explicit tmux choice instead of importing Herdr, and forced auto/restricted permissions. All four selected personal config hashes were unchanged. The bundle matched 63 tracked skill files plus one verified internal skill link; no duplicate skill installation was needed. No imported configuration was executed and no credential file was read by this import proof.
