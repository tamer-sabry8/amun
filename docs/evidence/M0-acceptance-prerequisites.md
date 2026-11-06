# M0 acceptance prerequisites — awaiting execution-location decision

The user's latest goal is completion of M0. Seven numbered tasks remain open (T006–T012); twelve additional tasks would cross the milestone boundary. M1 stays locked.

On 2026-11-06 the managed environment reports no configured secrets, runtime variables or outbound identities. GitHub access and macOS CI work. The local machine is Linux; Codex is present, Claude CLI is absent. No personal Pi credential files were opened to discover credentials.

| Gate      | Required setup                                                              | Why synthetic tests cannot close it                                                    |
| --------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| T006      | Authorised Copilot/OpenRouter sign-in in Amun-scoped Pi config              | Model metadata discovery does not prove authenticated inference                        |
| T007/T008 | Signed-in Codex and Claude workers with the selected backend                | Must dispatch actual workers and prove ten restart trials without duplicates           |
| T009      | Authorised Azure DevOps test organisation/project and secure PAT/connection | Must record created story/task IDs and a real revision conflict                        |
| T010      | Authorised authenticated-site test account                                  | Needs real sign-in/redirect evidence alongside sandbox tests                           |
| T012      | Apple Developer signing/notarization setup and clean-account Mac test       | Unsigned CI packaging cannot prove notarization, clean install or user-machine budgets |

The user has been asked whether these tests should run on their Mac using existing sign-ins or in cloud/CI with separate test accounts. Never paste credentials into chat or commit them. The selected location determines a concrete secure setup and test procedure. Existing personal Herdr sessions remain untouched either way.

No acceptance gate is waived by this document. Independent implementation can continue, but M0 cannot be marked complete until these tests have evidence.
