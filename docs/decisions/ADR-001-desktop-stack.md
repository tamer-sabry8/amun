# ADR-001: Electron and TypeScript for macOS

Status: accepted — user explicitly selected Electron/TypeScript
Milestone: M0

## Decision and user benefit

Follow the supplied plan: Electron + React with strict TypeScript, a separate utilityProcess service, typed MessagePort RPC, bundled pinned Pi and managed Firstmate homes. This provides the documented browser, terminal and runtime integration path while keeping product work in a macOS desktop app. It is not a SwiftUI/AppKit implementation.

## Security and performance

Sandbox the renderer, isolate contexts, disable Node integration, use a strict CSP and give browser content no preload bridge. Credentials and external writes belong to the service. Approval enforcement belongs to the writing connector. Never disable TLS validation. Measure cold startup, total process memory and editor latency in T012; choosing Electron does not establish that budgets pass.

## Visual direction

Use the supplied screenshot for the warm workspace, dark navigation, gold accents and purple primary action. The right edge is a narrow icon rail with hover/click drawers, not a permanently open sidebar. Preserve keyboard access, one-drawer behavior, hover intent and focus restoration from the plan. Firstmate is the plan's product name for the lead agent; Liaison in the screenshot is reference artwork. Detailed UI work remains in M1.

## Toolchain

Use Node 24.22.1 (available development runtime), pnpm 11.25.0 and TypeScript 6.0.2. TypeScript 7.0.2 was rejected because typescript-eslint 8.72.1 requires TypeScript below 6.1. Runtime Pi/Firstmate pins remain separate M0 proofs; the plan's reference-machine versions are not assumed installed here.

## Evidence and remaining gates

Linux can run unit and contract tests. The macOS CI workflow must independently pass; Finder launch, signing, Keychain, notarization, live worker dispatch and performance need Mac evidence. M0 remains open until those gates pass. GitHub API access currently returns Forbidden, although Git transport works.
