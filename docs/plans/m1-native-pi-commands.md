# M1 native Pi command coverage

The user explicitly expanded M1 on 2026-11-06: native Amun UI for every listed Pi command, plus user-facing prefixes/shortcuts and Firstmate skill commands. No terminal fallback. This does not mark M1 complete or unlock M2.

## Verified interfaces

Pinned Pi 1.4.0 ships `docs/slash-commands.md`, `docs/rpc-commands.md`, and public SDK declarations. RPC `get_commands` returns extension, prompt-template and skill commands only. Built-in terminal commands do not execute through `prompt`. The public SDK exposes AgentSession, AgentSessionRuntime, ModelRuntime, SettingsManager, ProjectTrustStore, resource loaders and MCP extension creation. Firstmate skills must execute in an Amun-owned real Git worktree with its own locks and permissions.

The supplied Paseo comparison is reference, not Amun compatibility evidence. No additional session backend is enabled. Internal CLI flags and Firstmate's roughly 150 toolbelt scripts are implementation references, not 150 new UI controls. Personal sessions/configurations remain out of scope.

## Acceptance ledger (all rows remain open until UI and live acceptance exist)

| Native surface           | Commands and behavior                                                                                                   | Implementation boundary                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model/settings forms     | settings, model, thinking, scoped-models, login, logout, llama                                                          | ModelRuntime/SettingsManager and supported router APIs; auth remains private and uses Edge                                                                                              |
| Session browser and tree | new, resume, name, session, tree, fork, clone, compact, import                                                          | AgentSessionRuntime/SessionManager; scope all selection to owned sessions; import previews retained ID/cwd and requires explicit safe destination                                       |
| Export/review sheets     | copy, export, share, bug, debug                                                                                         | Clipboard/native file dialogs and bounded preview; review exact content/destination before any upload; no automatic publication                                                         |
| Project/resources        | trust, mcp, reload, hotkeys, changelog, quit                                                                            | Public trust/resource/MCP interfaces; reload is not arbitrary installation; quit closes only the selected Amun session                                                                  |
| Loaded commands          | extensions, prompt templates, skill:name                                                                                | Discover the actual session catalog; preserve built-in precedence; bounded extension UI adapters; unknown commands never become model prompts                                           |
| Composer                 | @ attachments, path completion, ! shell with context, !! shell without context, send/steer/follow-up/queue recall/abort | Native pickers and explicit shell action; permissions and current session identity enforced in service; secrets and raw runtime records never forwarded wholesale                       |
| Presentation/shortcuts   | multiline, editor, tool/thinking visibility, model/thinking cycling, copy/paste image, clear, quit/suspend semantics    | Native controls and keyboard bindings; do not suspend Amun or unrelated workers for a terminal-only shortcut                                                                            |
| Firstmate                | afk, quiet/off, ahoy, bearings variants, updatefirstmate, stow, calm, supervision-model                                 | Loaded pinned skills/extensions in managed worktree; native equivalents for custom TUI presentation; update requires reviewed pinned-runtime workflow and cannot restart personal mates |

Current foundations: tested command router distinguishes native built-ins from loaded resource commands and validates bounded input/catalog. Initial typed SDK adapters cover model/thinking/name/stats/copy/compact/reload with bounded projections and busy-state refusal. They are not yet a complete native UI or a completed T022a gate.

Verification must include invalid input/security tests, source and packaged native UI acceptance, current runtime command discovery, real model and session behavior, and Firstmate permission/ownership preservation. Unavailable APIs or custom TUI components must be reported explicitly, never simulated as successful operations.

## First implementation evidence

The initial native command screen is connected through a dedicated SDK worker and strict command/result schemas. A real offline SDK proof created an owned session, changed its name, read statistics, and verified zero enabled tools/extensions. The source UI acceptance passes and the packaged UI acceptance passes (9.0 seconds): both set and retrieve a real SDK session name. Native process tests cover bounded/correlated replies, invalid records, secret-field rejection and stalled-worker cleanup. This increment does not provide complete session navigation, clipboard copy, export/upload, arbitrary resource UI, or Firstmate commands. `/copy` currently previews the reply; clipboard delivery remains open.

RED evidence: missing router, SDK adapter and contract modules; native UI missing its open control; accessible selector label mismatch caught by real UI test. GREEN logs: `/tmp/amun-commands-green.log`, `/tmp/amun-native-sdk-green.log`, `/tmp/amun-native-contract-green.log`, `/tmp/amun-native-process.log`, `/tmp/amun-native-ui-green2.log`, `/tmp/amun-native-packaged.log`. Domain coverage checks pass. Provider sign-ins and private profiles are unchanged by these disposable acceptance sessions.

## Session lifecycle follow-up

Actual source and packaged SDK lifecycle acceptance now covers new, resume, clone, tree-entry selection and fork. See [evidence](../evidence/M1/2026-11-06-subscription-and-native-sessions.md). This updates the earlier foundation limitation; full hierarchical presentation, imports and other command families remain open.

## Expanded native controls — d763366

Source and packaged acceptance now also covers native copy, runtime settings, scoped trust, JSONL/HTML transcript review, changelog paging, quit and model scope/cycling. Native save validates frame/format/content and creates only a new file selected by the OS dialog; 512 KiB document/review limits are explicit. Subscription buttons pass actual Codex and Claude CLI inference in source/package. `/hotkeys` describes available native controls without claiming terminal-shortcut parity. See the exact tested commits and limitations in the [evidence](../evidence/M1/2026-11-06-subscription-and-native-sessions.md). The user selected Notion only: native Pi `/share` is disabled with no gist/Radius fallback. T022b tracks exact redacted review, chosen parent and approved new-page publication (ADR-010). Remaining independent M1 work continues.

## Native authentication follow-up

Native `/login` now opens the supported provider selection and existing private Amun authentication dialog. Native `/logout` lists only credentials in the Amun-owned ModelRuntime and requires a short-lived, single-use confirmation before removal; busy sessions and stale/replayed confirmations fail closed. Source and packaged acceptance saved a disposable API-key canary, verified it remained until explicit confirmation, then verified removal. Personal profiles were not modified. This does not establish all remaining resource/command families. Tests and packaged logs: /tmp/amun-native-auth-source.log, /tmp/amun-notion-service-ui.log.

## Native import follow-up

Native file selection and explicit import review now use pinned Pi's `AgentSessionRuntime.importFromJsonl`. Source and packaged tests prove a real SDK session is imported, its ID retained and name readable, with duplicate IDs refused. Only the imported copy's working directory changes to Amun's private workspace after explicit review; an external parent-session link is removed and disclosed. The source file remains untouched. No tool or model request runs during import. Bounds: 512 KiB and 4096 records, Pi session version 3; unsupported formats fail explicitly. Single-use/expired confirmations, busy sessions, malformed trees and oversized input have unit coverage. This completes the tested import path, not the remaining MCP/router/resource/composer/Firstmate command families.

## Explicit blocked gate — llama router (2026-11-07)

The user confirmed there is no llama.cpp router available. Keep `/llama` live acceptance blocked; do not invent an endpoint, install a server, download models or treat fixtures as a live pass. Future acceptance needs an authorized router URL and permitted model operations. This does not block the independent native command and journey work.

## Conversation reading and receipt follow-up

The Conversations view now shows a bounded redacted transcript with the active session identity, empty-state handling and omitted-entry counts. The real owned SDK transcript is exercised in source/package UI tests. Published conversations lists verified persistent receipts without making a network write. These journey improvements do not close the still-open composer, MCP/resources, bug/debug, Firstmate or router command gates.

Native `/bug` now prepares a redacted local report with exact review/save. No automatic upload, transcript collection or credential/environment dump is performed. Gateway upload/ZIP parity is not claimed. See [native journey evidence](../evidence/M1/2026-11-07-native-journeys.md).

## Typed native commands and session branches

The source and packaged Conversations view now accepts supported built-ins directly in the composer. A real sibling-branch fixture verified the native hierarchy, current entry and navigation. Dynamic resources, Firstmate skill execution and the live llama router gate remain open. [Tested revision and acceptance evidence](../evidence/M1/2026-11-07-agents-and-native-tree.md).

## Firstmate update review and model selection

Both `/updatefirstmate` and `/skill:updatefirstmate` in Conversations resolve the upstream main revision. T022h passed staged promotion and packaged one-click rollback for newly prepared worktrees. [Candidate report](../evidence/M1/2026-11-07-firstmate-candidate.md).

Pi's Control+L binding opens the native model picker from the conversation. Control+P and Control+Shift+P cycle models in opposite directions. Keyboard handling is scoped to the Pi panel and preserves input-method composition.

## Amun-owned templates and skills

Source and packaged Pi sessions discovered private prompt templates and skills and expanded each into an editable draft in the originating conversation. The pinned SDK supplies the loaded resource catalog. Executable extensions and operational Firstmate skills remain open.

## Native diagnostics

The pinned terminal implementation of `/debug` writes terminal render lines and raw session messages. The native command opens a local JSONL export review containing the active session identity, Pi version, model, streaming state, redacted conversation text and count of omitted entries. Saving uses the existing native file chooser. The source and arm64 package passed the real-session journey after the original missing-command regression.

## Native crew bearings

The Conversations picker and typed `/bearings` or `/skill:bearings` use the current workspace's persistent primary worktree and the retained revision. The native digest projects the pinned snapshot into Captain’s Call, Recently Landed, Underway, and Charted Next. Plain mode leaves the dated report alone. File mode atomically replaces the daily report in that worktree. Explicit `include PRs` requests upstream discovery and displays its coverage. The real disposable crew used for acceptance had no associated GitHub repositories. Interactive board mode is still open.

## Native conversation files and shell

The captain can use the system file picker to add bounded UTF-8 text to the active session's editable draft. The service checks session identity and redacts the draft before display. Native `!` and `!!` run only after the captain clicks the labeled shell action. The owner selected ordinary Mac account permissions. The shell starts in the Pi workspace with the account's login shell and home. Amun bounds the captured output and redacts both command and output before calling Pi's session history API. A real external-file acceptance test checked the two recorded bash entries with the pinned SDK's model-context conversion. Only the `!` entry reached that conversion's output.

## Reviewed local extensions and Calm

The owner chose support for individually reviewed local JavaScript and TypeScript extensions. The native source review shows the exact code and SHA-256. Acceptance proved that choosing a file does not execute it, trusting it loads the reviewed copy into the pinned Pi runtime, replacing the original file does not change the installed command after restart, and revoking trust removes it from the active command list. The command showed a native confirmation and returned its notification after the captain answered. The adapter supports bounded confirmation, selection, text input, editor and notification surfaces. Arbitrary third-party terminal widgets remain outside the native adapter.

The native Calm command loads the retained Firstmate extension in an offline Pi RPC process. Actual command discovery, handled disposition and a verified worktree preference are required for success. Source and packaged tests toggled Calm across restarts and observed the native transcript’s operational detail change. Terminal animations and a full terminal rendering of tool rows were outside this test.

## Native turn queue and supervision model

The real Pi session's steering and follow-up queues are available during an active response. Queue requests bind to the live turn and conversation. The streaming test used a disposable loopback OpenAI-compatible provider, held the first response open, recalled a steering message, queued a follow-up, and inspected the second request. Only the follow-up reached it. Enter submits, Shift+Enter adds a line, Alt+Enter queues a follow-up, Alt+Up recalls, and Escape stops a response.

The supervision picker invokes the worktree’s own branch-supervision extension over Pi RPC. Both the model and effort dialogs come from the pinned extension. A disposable configured credential exercised the catalog and selection without model inference. The test read the saved model and effort from the actual primary worktree and checked the captain’s conversation model before and after.

Clipboard image paste previews decoded pixels in the originating draft. The source acceptance sent a one-pixel PNG through the real Pi session and inspected the image content in the loopback provider request. Pi settings and the active model must both permit images. Tab completes an @reference against the Pi workspace. Selecting a text file adds a redacted, editable copy. Control+G opens Amun’s multiline editor for the active draft. A separate post-restart test altered an installed extension on disk and revoked it through the native UI without executing the altered bytes.
