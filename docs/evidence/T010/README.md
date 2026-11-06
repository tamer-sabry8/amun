# T010 — isolated browser proof on the first installer’s Mac

2026-11-06, macOS Darwin / Apple silicon, Node 24.22.1 (isolated checksum-verified toolchain), pnpm 11.25.0. Starting revision f2e726c. Implementation is in the commit containing this evidence; this is local Mac execution, not CI.

TDD: policy-red.log records three meaningful failures (URL acceptance, product partitioning, narrow commands). e2e-red.log records the missing browser controls in real Electron before implementation.

Green: pnpm check passes 115 unit tests, lint, strict typecheck and formatting. pnpm test:e2e passes three live Electron tests, including the new browser proof. An HTTP server bound only to loopback serves a prototype and redirects to it. Actual page JavaScript reports require/process/ipcRenderer undefined, no opener and zero transferred ports; notification permission is denied, window.open is blocked, and forged window messages do not control Amun. The shell stays connected. Closing the browser destroys its web contents.

The proof uses WebContentsView with sandbox/context isolation, no preload, no Node integration, an Amun product partition separate from the shell, deny-all permissions/device access/downloads, and sender/main-frame validation for narrow main-process navigation commands. HTTPS and loopback HTTP are accepted; credentials in URLs, file/data/javascript schemes, control characters and remote plaintext HTTP are refused. Navigation, redirects and frame navigation use the same URL policy. Controls support back, forward, reload and close. Browser content receives no Amun service port. The UI is explicitly an M0 foundation proof, not the M1 product shell.

Limitations: popup-based authentication is blocked with an explicit message; redirect-based authentication is the supported proof path. The local redirect fixture is not live SSO or authenticated-site evidence. A real site/account still needs user sign-in directly in Amun. Cookies are not copied from Edge. T010 remains unchecked. Packaged validation must be rerun for this new implementation.

Owning API references: https://www.electronjs.org/docs/latest/api/web-contents-view and https://www.electronjs.org/docs/latest/tutorial/security .
