# Provision and verify Amun’s GitHub callback

The registered target is `https://amun.transfrm.ai/mcp/callback`. On the acceptance Mac on 7 November 2026, a request to that exact address failed at DNS resolution. GitHub separately issued a valid device challenge for Amun. Device sign-in completes at GitHub and polls the token endpoint. It does not exercise this callback.

1. In GitHub → Settings → Developer settings → OAuth Apps → Amun, verify the public client ID and the exact callback above. The supplied registration screenshot shows wildcard matching selected. Check the saved settings, clear that option, keep device flow enabled, and save. Keep the client secret in the hosting provider’s secret store if enabling the web flow.
2. Select the Cloudflare account and project that own the transfrm.ai zone. Confirm whether this subdomain is already reserved for another app. Deploy the callback handler to staging on the selected project first. It must consume a short-lived, single-use authorization transaction created by Amun, verify state and the PKCE binding, and exchange the authorization code on the server. Use an authenticated return to the initiating desktop session. Never place access or refresh tokens in a redirect, page, request log or analytics event. An informational landing page alone cannot pass this gate.
3. In Workers & Pages → the deployed Worker → Settings → Domains & Routes → Add → Custom Domain, enter amun.transfrm.ai. Check existing DNS records before changing anything. Cloudflare provisions DNS and the certificate. Verify the homepage and exact callback route over HTTPS.
4. From the Mac, open the callback with no parameters and with an invalid state. Both requests must fail safely without showing a success page or echoing query parameters. Verify unknown routes are not accepted as callbacks.
5. Start a fresh web authorization in packaged Amun. Complete GitHub consent in Edge. Verify the same initiating Amun session receives the grant, then list MCP tools and read a known file from the selected repository. Verify cancellation and replay rejection. Record the tested deployment revision and result, without codes or tokens.

Run `node scripts/github-callback-proof.ts` from the repository with its pinned Node version after deploying. It checks the exact HTTPS route with missing and synthetic invalid parameters and requires a rejection response with `Cache-Control: no-store`.

Track DNS/TLS, invalid-state handling, and the complete web authorization as separate checks. A working device login does not close this ticket.

References: [GitHub OAuth web and device flows](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Cloudflare Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
