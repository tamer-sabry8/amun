# ADR-009: Focused preview and explicit M0/release separation

Status: accepted by user, 2026-11-06.

Amun keeps one sandboxed, context-isolated persistent preview partition per product, with no preview preload, Node, service ports, cookie transfer or UA changes. Known Google/Microsoft/Apple identity-provider hosts are blocked in main navigation, redirects and popups; subframe IdP navigation is denied without a banner. A user click may restart login externally from the original app entry point. Opening the intercepted OAuth URL is not treated as a portable authenticated flow. Chrome's verified bundle ID is com.google.Chrome; default-browser fallback is explicit. Handoff IDs expire, are single-use and globally throttled per window; stale asynchronous callbacks cannot revive a prior action.

Existing HTTPS/loopback-only URL and deny-all permission/download policies remain. The finite rule list does not detect arbitrary tenant/custom-domain SSO. No Vercel/Cloudflare live chain was supplied or invented. The full proposal's file protocol, annotations, screenshot attachments, configurable host-rule settings and agent delivery are retained for later product milestones. No agent browser automation gateway or OpenCode backend is introduced.

The user explicitly narrowed M0 to the browser foundation and moved signing, notarization, signed native dependencies, notarized DMG and clean-account release installation to open release gate R001. This is a scope decision, not successful release evidence. M0 now accepts the tested unsigned development package and measured performance baseline. Public release remains blocked by R001. The user authorized PR #1 merge only after the revised M0 gates pass; no M1 work is authorized by completing this milestone.

Sources: [Google secure-browser policy](https://developers.google.com/identity/protocols/oauth2/policies), [Electron navigation semantics](https://www.electronjs.org/docs/latest/api/web-contents), [Electron sessions/permissions](https://www.electronjs.org/docs/latest/api/session). Installed Electron 45.2.3 declarations were checked, including programmatic-navigation gaps.
