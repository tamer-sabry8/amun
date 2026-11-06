# Explicit non-Herdr backend selection

The user clarified that Amun is not intended to use Herdr. Herdr only describes their existing personal setup, which must remain unaffected. This supersedes the original plan's Herdr default.

TDD: `backend-selection-red.log` records three failures demonstrating implicit Herdr creation and acceptance of imported Herdr. `backend-selection-green.log` records all managed-home tests passing after the fix.

Managed homes now require explicit tmux selection and reject Herdr before creating directories. Invalid dispatch configuration is still checked with an otherwise valid backend. The source and packaged Firstmate startup proof explicitly selects tmux; it does not launch tmux, dispatch workers, or establish backend operational readiness.

No existing personal home is modified. No claim is made that Amun has a complete replacement session manager. M0 must still prove worker dispatch, permission handling and recovery without Herdr before this feature is usable.
