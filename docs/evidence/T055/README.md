# T055 approved visual baselines

The Mac owner review contains 78 PNGs. In each theme it includes 16 packaged workspace views, four Island size galleries, five drawers and the controls gallery with the status pill states. The current gallery and drawer tests matched the existing baselines. The new workspace views use a disposable synthetic product and the rebuilt renderer with the corrected inspector tab list.

The local review is beside the M6 worktree in `m6-visual-review/index.html`. Open a screenshot to inspect its native pixels. The file manifest is `m6-visual-review/SHA256SUMS`, with SHA-256 `fcad1bc1f6a3891f43c44bffe2968fe9cab07f81e04695dba86769f8a081d2e1`. All 78 entries verified. The owner approved all 78 images. A separate local baseline copy lives in `m6-approved-baselines` beside the worktree. Verify it with `shasum -a 256 -c SHA256SUMS` in that directory. The repository retains the [approved manifest](SHA256SUMS).
