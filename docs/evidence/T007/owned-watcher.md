# Real owned watcher on the local Mac

The first ownership probe exposed a real mismatch: Pi’s RPC-only entry sets process.title to pi-rpc, which the pinned Firstmate ancestry classifier does not recognise as the intended Pi session. fm-lock.sh reported acquisition but its recorded PID was not the launched Pi PID. This failed the acceptance assertion; acquisition output alone was not accepted.

Use the documented bundled `dist/bundle/cli.js --mode rpc` entry for Firstmate sessions. Pi’s setupCli sets its normal pi process identity; the same supported fm-lock.sh command now records the exact launched Pi process in both source Node and packaged Electron-as-Node execution. No installed source, personal lock, classifier, or lock file was patched or forged.

The authored test extension calls only the supported lock command inside a disposable managed home. The subsequent registered /fm-watch-arm-pi command starts real supervision. A live watcher PID and a fresh .last-watcher-beat were observed in both source and packaged execution. Without the arm command the owned-watcher check fails (owned-watcher-red.log). Both successful runs had zero worker dispatches and zero model turns.

Shutdown closes Pi’s stdin for its normal session shutdown, then invokes fm-watch-arm.sh --stop with exactly the disposable home’s environment; no unscoped process cleanup occurs. This proves ownership and initial watcher operation. It does not yet prove actionable wake consumption, watcher recovery, secondmate permission propagation, authenticated worker dispatch or persistent reattachment. T007 and T008 remain open.
