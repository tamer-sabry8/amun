const home =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Amun</title><main><h1>Amun</h1><p>Amun is a macOS workspace for product teams.</p></main></html>';
export default {
  /** @param {Request} request */
  fetch(request) {
    const url = new URL(request.url);
    const headers = {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    };
    const reply = (status, body) =>
      new Response(request.method === "HEAD" ? null : body, {
        status,
        headers,
      });
    if (url.origin !== "https://amun.transfrm.ai")
      return reply(404, "Unknown host.");
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, {
        status: 405,
        headers: { ...headers, Allow: "GET, HEAD" },
      });
    if (url.pathname === "/mcp/callback")
      return reply(400, "No active web sign-in transaction. Return to Amun.");
    if (url.pathname !== "/") return reply(404, "Page unavailable.");
    headers["Content-Type"] = "text/html; charset=utf-8";
    return reply(200, home);
  },
};
