# T006 — Pi framing and live RPC spike

Pinned official package: @earendil-works/pi-coding-agent 1.4.0. All transitive resolutions and integrity hashes are in pnpm-lock.yaml.

`red.log`: six parser tests fail against a stub. `green.log`: 51 workspace unit tests pass after implementing bounded LF-only JSON framing. Frames preserve Unicode separators, accept CRLF, reject malformed/oversized data, and reject truncated final records. Incoming byte streams must use UTF-8 decoding before calling the parser.

`live-rpc.log`: `node scripts/pi-proof.ts` received successful get_state and get_available_models replies from the real pinned Pi RPC entry. The probe ran in a temporary isolated directory with private Pi config and no provider credential environment variables, then killed the child and removed the temporary directory. The execution sandbox caused an early exit; the same isolated probe succeeded with normal process execution permissions. No model generation or authenticated provider access is claimed. Raw model/config data is deliberately not logged.

Open acceptance: packaged app runtime discovery, bundled Node/Electron-as-Node decision, authentication in Amun-scoped storage, recorded streaming and extension UI fixtures, provider-specific readiness. T006 remains unchecked.
