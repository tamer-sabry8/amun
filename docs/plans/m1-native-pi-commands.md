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

Source and packaged acceptance now also covers native copy, runtime settings, scoped trust, JSONL/HTML transcript review, changelog paging, quit and model scope/cycling. Native save validates frame/format/content and creates only a new file selected by the OS dialog; 512 KiB document/review limits are explicit. Subscription buttons pass actual Codex and Claude CLI inference in source/package. `/hotkeys` describes available native controls without claiming terminal-shortcut parity. See the exact tested commits and limitations in the [evidence](../evidence/M1/2026-11-06-subscription-and-native-sessions.md). Share destination is awaiting user input; remaining independent M1 work continues.
