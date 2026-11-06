# M0 acceptance prerequisites — Mac selected; local execution access required

The user's latest goal is completion of M0. Seven numbered tasks remain open (T006–T012); twelve additional tasks would cross the milestone boundary. M1 stays locked.

On 2026-11-06 the managed environment reports no configured secrets, runtime variables or outbound identities. GitHub access and macOS CI work. The local machine is Linux; Codex is present, Claude CLI is absent. No personal Pi credential files were opened to discover credentials.

| Gate      | Required setup                                                              | Why synthetic tests cannot close it                                                    |
| --------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| T006      | Authorised Copilot/OpenRouter sign-in in Amun-scoped Pi config              | Model metadata discovery does not prove authenticated inference                        |
| T007/T008 | Signed-in Codex and Claude workers with the selected backend                | Must dispatch actual workers and prove ten restart trials without duplicates           |
| T009      | Authorised Azure DevOps test organisation/project and secure PAT/connection | Must record created story/task IDs and a real revision conflict                        |
| T010      | Authorised authenticated-site test account                                  | Needs real sign-in/redirect evidence alongside sandbox tests                           |
| T012      | Apple Developer signing/notarization setup and clean-account Mac test       | Unsigned CI packaging cannot prove notarization, clean install or user-machine budgets |

The user selected their Mac using existing sign-ins. They supplied Pi and Firstmate installation paths and confirmed Codex/Claude CLIs are installed there. Direct checks show this task still runs on Linux and cannot access those Mac paths. A local execution context is required; see [Mac handoff](../MAC-ACCEPTANCE-HANDOFF.md). The user has no Apple account signed in; unsigned development testing can proceed, while release signing/notarization remains open. Never paste credentials into chat or commit them. Existing personal Herdr sessions must be preserved.

No acceptance gate is waived by this document. Independent implementation can continue, but M0 cannot be marked complete until these tests have evidence.

## Local continuation supersedes historical execution blockers

Local macOS execution and installations are verified. ICV API access, authorised test writes, and revision conflict acceptance pass (T009). Azure DevOps must be accessed by API only from Amun; corporate browser access is Edge-only. An embedded Azure sign-in attempt was stopped and its dedicated window closed. Browser acceptance needs a different permitted site. Source/packaged terminal and initial owned watcher proofs pass; full worker recovery and remaining release gates are still open. See M0-local-mac.md, T009/README.md, T007/owned-watcher.md and T011/README.md.
