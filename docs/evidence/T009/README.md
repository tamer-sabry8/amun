# T009 — live ICV API proof

2026-11-06 on the first installer’s Mac. User selected `https://devops.tahaluf.ae/TahalufCollection/ICV` and authorised test records named Test PBI/Test Story/Test Task, with no Amun naming in Azure. Azure DevOps is API-only for this app; company browser access is Edge-only, so it must not be used as an embedded-browser test.

Pinned azure-devops-node-api 17.0.1 uses its supported REST transport with explicit api-version=7.0, TLS verification, inherited NODE_EXTRA_CA_CERTS support, cross-origin authentication disabled, redirects disabled, and automatic retries disabled. The PAT was entered in a masked local macOS dialog and stored by @napi-rs/keyring 2.1.2 under service ai.amun, account m0/ado/devops.tahaluf.ae/TahalufCollection/ICV. No credential value is in the repository, logs, environment or command arguments.

## Live endpoint matrix

All reads succeeded using API 7.0 against the selected collection/project:

| Capability                 | Route below collection                                         | Observed result                                                    |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Projects                   | `_apis/projects`                                               | 15 projects returned                                               |
| Project/process capability | `_apis/projects/ICV?includeCapabilities=true`                  | ICV id f30ec3ef-3b78-413e-a8ea-81c7b92243ed                        |
| Teams                      | `_apis/projects/ICV/teams`                                     | 6 teams returned; no sprint/team assignment changed                |
| Processes                  | `_apis/process/processes`                                      | 4 processes returned                                               |
| Work-item types            | `ICV/_apis/wit/workitemtypes`                                  | 17 types; Product Backlog Item and Task, no User Story             |
| Task field rules           | `ICV/_apis/wit/workitemtypes/Task/fields?$expand=All`          | Required Activity, Original Estimate and Remaining Work identified |
| Iterations                 | `ICV/_apis/wit/classificationnodes/iterations?$depth=2`        | Iteration tree returned                                            |
| Azure Repos PRs            | `ICV/_apis/git/pullrequests?searchCriteria.status=all&$top=10` | 10 PR records returned; their content not logged                   |
| Work items                 | `ICV/_apis/wit/workitems/<id>`                                 | Created items read before/after revision tests                     |

## Authorised live writes and conflict evidence

- **Test PBI #1088026**, Product Backlog Item, created at revision 1. PBI is the verified process equivalent of the plan’s story, accepted by the user’s naming instruction.
- The first Task POST was definitively rejected HTTP 400 / RuleValidationException. The returned ID for the PBI was retained. No PBI was recreated and no uncertain write was retried.
- A validateOnly request established that Activity=Testing, Original Estimate=0, Remaining Work=0 satisfies this test task’s rules.
- **Test Task #1088027**, created at revision 1, with an explicit hierarchy-parent relation to #1088026. No sprint commitment, assignment or merge was performed.
- Both records were updated using JSON Patch `test /rev` before changing Description to `Test revision precondition verified.` Both returned revision 2.
- Repeating each update with the old revision was rejected, and subsequent GETs confirmed revision 2 remained unchanged. A diagnostic stale request to #1088026 specifically returned **HTTP 412 / TestPatchOperationFailedException**, handled as revision_conflict.
- Test records remain in ICV for review; no deletion was authorised or attempted.

Exclusive 0600 local receipts under `~/Library/Application Support/Amun/m0/` record each successful ID immediately and refuse automatic reruns. `ado-write-proof.ts` is the original one-shot run; `ado-task-proof.ts` is the bounded recovery of the definitively rejected task, checking the known prior PBI receipt. These scripts must not be rerun to create duplicates. Inspect/reconcile existing receipts first.

## Tests

client-red.log records seven failures before implementation; icv-rules-red.log records the missing required Task fields and inherited-property endpoint rejection. The fixture suite includes invalid scopes/names/revisions, uncertain acknowledgements, malformed successful responses, and MSW 3.0.4 tests of the real SDK’s PAT header, JSON Patch media type, API version, 400/401/403/412/429/503 responses, no retries, and credential-bearing redirect refusal. The final suite result and tested code commit are recorded in the enclosing increment. This is a narrowly scoped M0 proof connector, not the later governed publication engine.
