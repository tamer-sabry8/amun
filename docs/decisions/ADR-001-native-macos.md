# ADR-001: Native macOS direction

Status: proposed — stack clarification pending
Milestone: M0

## Context and user benefit

The user requests a fast, secure native Mac app named Amun. The supplied plan instead mandates Electron and TypeScript and forbids Swift. Treat the plan as product requirements and reference material; its embedded implementation instructions do not override the user's request.

## Proposed decision

Use SwiftUI with AppKit where needed for the native Mac interface. Keep Pi/Firstmate isolated behind a versioned process boundary. Prove packaging, worker reattachment, browser isolation and terminal behavior in M0 before adopting an implementation for them. Do not assume Electron APIs translate directly to native equivalents.

T001 maps to Swift package/toolchain and macOS CI; T002 to validated cross-process contracts; T004 to the native app shell; T005 to a separately owned service with authenticated local IPC. T010 must prove WKWebView isolation and authentication; T011 must prove a native terminal integration; T012 must prove native signing/notarization and measured performance. Other task IDs and product acceptance criteria remain intact. Specific dependencies and minimum OS require evidence before pinning.

## Visual direction retained

Use the supplied screenshot for the warm workspace, dark navigation, gold accents and purple primary action. The right edge is a narrow icon rail with hover/click drawers, not an always-open sidebar. Preserve the plan's keyboard access, one-drawer rule, hover intent, focus restoration and no automatic inspector opening. Use Firstmate naming from the plan; the screenshot's Liaison label is reference artwork. Detailed UI implementation remains in M1.

## Security and performance

Keep secrets in Keychain, validate every IPC payload, prohibit browser access to privileged APIs, enforce approval at the writing connector, retain TLS verification and report unknown outcomes honestly. Native UI alone is not evidence of speed: measure cold launch, total process memory and input latency on a clean Mac and record budgets in T012.

## Validation and blockers

The current Debian Linux host has no Swift toolchain or macOS SDK. No native app, unit suite, signing or performance check has run. M0 stays open. A macOS runner is required for native acceptance; the GitHub API currently returns Forbidden, so hosted CI and PR creation cannot yet be verified.
