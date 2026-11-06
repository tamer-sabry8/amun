# T010 — isolated browser proof on the first installer’s Mac

2026-11-06, macOS Darwin / Apple silicon, Node 24.22.1 (isolated checksum-verified toolchain), pnpm 11.25.0. Starting revision f2e726c. Implementation is in the commit containing this evidence; this is local Mac execution, not CI.

TDD: policy-red.log records three meaningful failures (URL acceptance, product partitioning, narrow commands). e2e-red.log records the missing browser controls in real Electron before implementation.

Green: pnpm check passes 115 unit tests, lint, strict typecheck and formatting. pnpm test:e2e passes three live Electron tests, including the new browser proof. An HTTP server bound only to loopback serves a prototype and redirects to it. Actual page JavaScript reports require/process/ipcRenderer undefined, no opener and zero transferred ports; notification permission is denied, window.open is blocked, and forged window messages do not control Amun. The shell stays connected. Closing the browser destroys its web contents.

The proof uses WebContentsView with sandbox/context isolation, no preload, no Node integration, an Amun product partition separate from the shell, deny-all permissions/device access/downloads, and sender/main-frame validation for narrow main-process navigation commands. HTTPS and loopback HTTP are accepted; credentials in URLs, file/data/javascript schemes, control characters and remote plaintext HTTP are refused. Navigation, redirects and frame navigation use the same URL policy. Controls support back, forward, reload and close. Browser content receives no Amun service port. The UI is explicitly an M0 foundation proof, not the M1 product shell.

Limitations: popup-based authentication is blocked with an explicit message; redirect-based authentication is the supported proof path. The local redirect fixture is not live SSO or authenticated-site evidence. A real site/account still needs user sign-in directly in Amun. Cookies are not copied from Edge. T010 remains unchecked. Packaged validation must be rerun for this new implementation.

Owning API references: https://www.electronjs.org/docs/latest/api/web-contents-view and https://www.electronjs.org/docs/latest/tutorial/security .

## Live GitHub acceptance failure — 2026-11-06

Tested unsigned packaged build from c1f4548 on the user's Mac. GitHub login opened inside Amun; the user followed Google sign-in. The supplied screenshot and user report show Google rejecting the embedded flow with “This browser or app may not be secure.” No authenticated GitHub page or session-persistence success was observed. The proof was stopped after the reported rejection. T010 remains incomplete.

Google's OAuth policy explicitly prohibits directing authorization requests to embedded user-agents under developer control: https://developers.google.com/identity/protocols/oauth2/policies#use-secure-browsers . The observed failure is consistent with that restriction; the screenshot alone cannot identify every detection signal. No user-agent spoofing, cookie extraction, disabled security or repeat attempts are justified. Signing/notarizing Amun is not established as a remedy.

A supported direct GitHub sign-in, if already available to this account, is a possible separate test; it has not been attempted or proven. Otherwise use another authorised site supporting embedded authentication, or retain this gate as blocked. System-browser OAuth for an API connector is a separate architecture and does not automatically establish a logged-in embedded web session.

The reproducible manual probe is scripts/browser-auth-proof.ts. It reports only authentication/isolation booleans, never cookie or credential values. Source and packaged local prototype/security tests passed previously; they do not override this live failure. Google sign-in inside the embedded browser is not supported by this proof.
