# Pi service and renderer boundary

Local macOS red/green evidence is adjacent. PiSession projects only bounded text deltas and validated select/confirm fields into strict shared contracts. Raw runtime records, error bodies and credentials never cross the renderer port. Invalid/expired answers are refused; unrenderable dialogs are cancelled; output is bounded; transport failure closes the session and reports unavailable. Prompt acknowledgement is not inference completion.

The app now launches a private, offline Pi protocol proof from the bundled CLI, with no personal config, model credentials, skills or MCPs. Real Pi extension select/confirm dialogs round-trip through utilityProcess, MessagePort and renderer buttons. Source and packaged Electron tests pass. The renderer uses textContent, never runtime HTML. This is explicitly an offline protocol proof; the previous authenticated provider proof is separate. Provider selection/inference in the interactive app, richer lifecycle/error handling and full T006 acceptance remain open.

Update: authenticated provider selection and inference now cross this boundary in source and packaged tests; see [authenticated UI evidence](authenticated-ui.md).
