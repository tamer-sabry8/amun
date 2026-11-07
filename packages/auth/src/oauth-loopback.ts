import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

/** A single-use, service-owned callback; no provider text is rendered or logged. */
export async function createOAuthLoopback(options: {
  issuer: string;
  port?: number;
  timeoutMs?: number;
}) {
  const issuer = new URL(options.issuer);
  if (issuer.protocol !== "https:" || issuer.origin !== options.issuer)
    throw Error("Invalid authorization issuer");
  const port = options.port ?? 0;
  const timeout = options.timeoutMs ?? 600_000;
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 600_000
  )
    throw Error("Invalid callback options");
  const state = randomBytes(32).toString("base64url");
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const code = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Attach an observer immediately: expiry may precede the caller awaiting consent.
  void code.catch(() => undefined);
  let url = "";
  let settled = false;
  const timer: { current?: ReturnType<typeof setTimeout> } = {};
  const stop = () => {
    clearTimeout(timer.current);
    server.close();
    server.closeIdleConnections();
  };
  const close = () => {
    if (!settled) {
      settled = true;
      reject(Error("Sign-in cancelled"));
    }
    stop();
  };
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    const bad = () => {
      response.writeHead(400).end("Invalid sign-in callback.");
    };
    if (
      settled ||
      request.method !== "GET" ||
      request.headers.host !== new URL(url).host ||
      !request.url?.startsWith("/callback?") ||
      request.url.length > 16384
    )
      return bad();
    const query = new URL(request.url, url).searchParams;
    if (
      [...query.keys()].some(
        (key) =>
          ![
            "code",
            "state",
            "iss",
            "error",
            "error_description",
            "error_uri",
          ].includes(key) || query.getAll(key).length !== 1,
      )
    )
      return bad();
    const supplied = Buffer.from(query.get("state") ?? "");
    const expected = Buffer.from(state);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected) ||
      query.get("iss") !== options.issuer
    )
      return bad();
    const value = query.get("code");
    const error = query.get("error");
    if (
      (!value && !error) ||
      (value && error) ||
      (value && (value.length > 8192 || /[\x00-\x20\x7f]/.test(value)))
    )
      return bad();
    settled = true;
    response
      .writeHead(200)
      .end(
        error
          ? "Sign-in cancelled. Return to Amun."
          : "You can return to Amun.",
      );
    if (error) reject(Error("Sign-in cancelled"));
    else resolve(value!);
    stop();
  });
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", no);
      yes();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    close();
    throw Error("Callback unavailable");
  }
  url = `http://127.0.0.1:${address.port}/callback`;
  timer.current = setTimeout(() => {
    if (!settled) {
      settled = true;
      reject(Error("Sign-in expired"));
      stop();
    }
  }, timeout);
  timer.current.unref();
  return { url, state, code, close };
}
