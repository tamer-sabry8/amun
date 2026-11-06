# Research brief: GitHub → Google sign-in rejected inside Electron

Please research a supported solution using current primary sources. Do not suggest user-agent spoofing, extracting browser cookies, disabling browser security, or inventing an OAuth callback for a third-party website.

## Actual setup and failure

Amun is a macOS desktop app using Electron 45.2.3 and TypeScript. Its browsing/preview feature uses WebContentsView with sandbox=true, contextIsolation=true, nodeIntegration=false, no preload, and a persistent session partition separate from the app shell. External tools integrate through APIs/MCPs; the embedded browser is not an integration substitute.

GitHub's login page loads inside the embedded view. The user chooses Continue with Google and Google rejects the flow with “This browser or app may not be secure.” The user uses Google sign-in only, with no existing direct GitHub password path available for this test. No cookies were imported from Chrome or Edge.

The actual test used an unsigned packaged Electron app on the user's Mac, launched through Playwright. The screenshot proves rejection, but does not isolate whether embedded-user-agent detection, automation detection, or another signal triggered this particular rejection. Do not claim app signing/notarization would fix it without evidence.

Google's published OAuth policy prohibits directing authorization requests to developer-controlled embedded user-agents:
https://developers.google.com/identity/protocols/oauth2/policies#use-secure-browsers

## Questions to resolve

1. Is this GitHub → Google login flow supported at all inside Electron WebContentsView under Google's current policy?
2. If sign-in must use the user's external Chrome browser, is there a documented, supported way for GitHub to establish the resulting website session in a separate embedded browser without transferring cookies or credentials? Distinguish API OAuth tokens from website login sessions.
3. Does GitHub offer any supported desktop-authentication bridge for this purpose, or should the entire authenticated website stay in the external browser?
4. What browsing architecture preserves a useful embedded local-prototype/preview feature while using an external browser for unsupported SSO sites?
5. How should acceptance criteria distinguish authenticated API access, external-browser sign-in, and an actually authenticated embedded webpage?

## Constraints

Keep the Electron/TypeScript stack. Do not ask the user to change their account's sign-in method. Preserve personal browsers, sessions and sign-ins. Azure DevOps must remain API-only in Amun; company website access is Edge-only. T010 remains blocked while this is researched, and other M0 engineering continues.
