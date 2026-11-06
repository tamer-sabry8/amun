# Focused M0 preview acceptance — 2026-11-06

- Source and packaged Electron suites: eight tests each passed, including existing isolation/prototype/permission/popup tests, new redirect/popup/subframe handoff behavior, and direct-login persistence across full app restart.
- A real local first-party app accepted a test password, issued an HttpOnly SameSite session cookie, and rendered signed-in content after full Amun restart. A second product partition remained signed out. This is controlled real HTTP/session evidence, not a mock or proof of compatibility with arbitrary third-party sites.
- Native packaged Chrome handoff passed: the local server observed the original app URL reached in Chrome after the actual trusted-shell button invoked the verified bundle ID. No cookies were copied. The proof leaves one harmless local acceptance page in Chrome, which can be closed.
- Automated provider redirects were intercepted defensively: no test contacted Google. The prior real Google rejection is retained as historical evidence. Actual Google account sign-in is no longer a requirement of the user-revised M0.
- Pure preview decision, Run mapping and acknowledgement modules have 100% measured line/branch coverage. Browser adapter line coverage is 90.43%, above the specified 80%. Per-module gates are enforced by the pinned Vitest V8 provider in CI.
- Live protected Vercel/Cloudflare chains, arbitrary federated providers, annotations, local-file preview, screenshots-to-agent and settings are not claimed. The user retained those larger features for later work; see ADR-009 and STRESS-TEST.

Evidence: `docs/evidence/T010/{navigation-red,handoff-red,stale-handoff-red,source-preview-suite,packaged-preview-suite,coverage}.log` and `native-chrome-handoff.json`. The code/evidence commit is identified in PR #1 and the final handoff.
