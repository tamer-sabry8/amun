# ADR-002: Service recovery and Pi RPC proof

Status: accepted for foundation proof; packaging decision pending
Milestone: M0, T005–T006

## Decision

Electron utilityProcess owns service work. A minimal sandbox preload transfers MessagePorts and forwards connection state; it exposes no generic Electron API. The service validates every health request and the renderer validates response shape and correlation ID. Crash recovery uses new ports and bounded exponential delay; no worker is spawned by recovery.

Use the official Pi 1.4.0 package and its exported RPC entry for the runtime spike. Inspecting the installed package established this entry rather than assuming the latest repository layout. The probe uses the current Node executable, a temporary private config directory, no provider credential environment, and a fixed 15-second timeout. Production packaging must separately prove the bundled executable choice; developer Node is not a shipping dependency decision.

## Evidence

macOS service recovery: docs/evidence/T005/macos.md. Pi framing and live RPC: docs/evidence/T006/README.md. Framing has a one-MiB per-record limit, UTF-8 stream decoding, LF splitting and explicit malformed/truncated handling. This bounds accidental output accumulation; it is not an agent execution sandbox.

## Remaining security boundary

Schema validity does not authorise writes. Approval verification remains in the writing connector (M1). Browser panels receive no preload. Provider sign-in, worker reattachment, credentials, release signing and packaged runtime integrity still require their own proofs.
