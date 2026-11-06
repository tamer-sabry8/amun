# Private tmux namespace proof

M0 only. Unit tests were written first: `tmux-scope-red.log` records four failures, and `tmux-scope-green.log` records the implemented behaviour passing.

`createTmuxScope` allocates an exclusive 0700 directory with a short canonical path, reserving space for macOS Unix-domain socket limits. `tmuxEnvironment` uses an allowlist and explicitly sets `FM_BACKEND=tmux` and the allocated `TMUX_TMPDIR`. It excludes inherited TMUX, backend configuration overrides, other terminal selectors, shell startup hooks and provider credentials. Existing process environment is unchanged.

The source and packaged Firstmate startup proofs now use that launch environment. This does not enable workers.

`pnpm test:tmux` is a macOS CI integration check requiring tmux. It creates two synthetic private servers, each with a session called `firstmate`; verifies different socket paths; invokes the pinned Firstmate adapter through its supported loader; shuts down only the Amun fixture server; and checks the other fixture's pane process remains unchanged. Both servers disable personal tmux configuration with `-f /dev/null`, use temporary HOME directories, and are cleaned up through their own scoped environment. It uses no model or worker credentials.

## Remaining gates

- No live user installation is touched by this test. No Claude or Codex workers are dispatched.
- The product launcher must start a verified tmux executable with an explicit clean configuration before Firstmate can create workers. PATH discovery is not executable trust validation.
- Persist the scope with ownership metadata so service/app restart reconnects to the same server. Do not allocate a new scope on every reconnect or delete a live server's socket directory.
- Prove scope/permission propagation into workers and secondmate homes; shutdown policy must preserve recoverable workers.
- Socket namespacing prevents accidental collisions; it is not a security boundary against malicious code running as the same OS user.

These foundations leave T007/T008 open.

## macOS result

[CI run 42150376823](https://github.com/tamer-sabry8/amun/actions/runs/42150376823) passed for implementation commit `0f1f992786313a4adb45f8d14c102d4db5590851`: 90 unit tests, lint/type/format checks, real tmux isolation probe, source and packaged Firstmate startup, Pi RPC probes, and source/packaged Electron isolation and crash recovery. This establishes synthetic-session isolation, not authenticated worker dispatch.
