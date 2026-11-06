# M0 preview guide

Open an HTTPS page or a loopback HTTP dev server in the proof panel. The panel has its own per-product persistent profile. Direct first-party sign-in can persist there; it does not share Chrome/Edge cookies. Pages receive no Node or Amun service access. Permissions and downloads are denied; popups remain blocked.

For supported Google/Microsoft/Apple identity-provider hosts, Amun stops navigation and offers Open in Chrome or Open in default browser. This restarts login from the original app entry point in that browser's own session. It does not sign the Amun panel in. Only the destination host appears in the banner. The action expires after one minute; navigate again to create a fresh action. Dismiss hides the banner. Unknown custom-domain SSO is not automatically classified; no universal SSO support is claimed.

Azure DevOps remains an API integration; company web access belongs in Edge. No browser-cookie import is available. Local-file protocol, annotations, pasted screenshot cards, rule-editing settings and clear-panel-data UX are not implemented in M0 and remain later work.
