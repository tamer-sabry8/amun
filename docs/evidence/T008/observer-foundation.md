# Scoped observation foundation — T008 remains open

Inspected pinned Firstmate bin/fm-spawn.sh metadata publication and bin/backends/tmux.sh. state/<id>.meta is key=value data; absent backend means tmux, and spawn_gen distinguishes launches. The observer parses bounded metadata without sourcing it and refuses ambiguous/unsupported records.

Private 0700 receipt directories hold exclusive 0600 identity files. The receipt includes the private socket, an Amun-owned server token, task generation, pane/window IDs, PIDs and worktree. Reads refuse symlinks, excessive sizes, loose permissions and identity mismatch. Read-only recovery issues only scoped show-options/list-panes commands; it cannot spawn workers or change ownership. Endpoint verification is explicitly separate from worker liveness: worker remains unknown.

Unit red/green evidence covers stale identities, duplicates, invalid paths, unavailable backend and private receipt persistence. The real tmux synthetic-pane probe uses ten fresh observer processes and proves unchanged pane identity and unknown after an ownership-token mismatch. It is NOT ten service restarts with real Codex/Claude workers and does NOT satisfy the T008 exit gate. Firstmate metadata in this probe is a labelled fixture; actual dispatched task records and worker process identity remain to be verified.

Live probing found that tmux display-message sanitizes tabs to underscores. The probe now uses a printable separator; ambiguous inventory is refused. No personal tmux server or worker was accessed.

Read-only worker CLI readiness probes in disposable homes found Claude unauthenticated. Codex initially failed to launch with a PATH lacking its required Node; repeating with the pinned Node executable available returned “Not logged in.” These are isolated-home readiness results, not failures of the user's existing sign-ins. Supported worker credential reuse or separate scoped sign-in is still needed before authenticated dispatch; no personal credential store was copied by these probes.
