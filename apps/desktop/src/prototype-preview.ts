import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { prototypeDesign } from "../../../packages/contracts/src/prototype.ts";
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export async function openPrototypePreview(
  input: unknown,
  active: () => boolean,
) {
  const design = prototypeDesign.parse(input),
    path = "/" + randomBytes(32).toString("hex");
  const pins: { element: string; feedback: string }[] = [];
  let origin = "";
  const html = () =>
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' +
    escape(design.title) +
    "</title><main><h1>" +
    escape(design.title) +
    "</h1>" +
    design.elements
      .map(
        (e) =>
          "<section><h2>" +
          escape(e.label) +
          "</h2><p>" +
          escape(e.description) +
          "</p><details><summary>Pin feedback to " +
          escape(e.label) +
          '</summary><form method="post"><input type="hidden" name="element" value="' +
          e.id +
          '"><label>Feedback <input name="feedback" required maxlength="512"></label><button>Pin feedback</button></form></details>' +
          pins
            .filter((p) => p.element === e.id)
            .map((p) => "<p>Feedback: " + escape(p.feedback) + "</p>")
            .join("") +
          "</section>",
      )
      .join("") +
    "</main></html>";
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (
      !active() ||
      req.url !== path ||
      "http://" + req.headers.host !== origin
    ) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "POST") {
      if (
        req.headers.origin !== origin ||
        !req.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        res.writeHead(403).end();
        return;
      }
      let body = "";
      try {
        for await (const chunk of req) {
          body += chunk.toString();
          if (body.length > 8192) {
            res.writeHead(413).end();
            return;
          }
        }
      } catch {
        return;
      }
      const fields = new URLSearchParams(body),
        element = fields.get("element"),
        feedback = fields.get("feedback")?.trim();
      if (
        !active() ||
        !element ||
        !design.elements.some((e) => e.id === element) ||
        !feedback ||
        feedback.length > 512 ||
        pins.length >= 32
      ) {
        res.writeHead(400).end();
        return;
      }
      if (!pins.some((p) => p.element === element && p.feedback === feedback))
        pins.push({ element, feedback });
    } else if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(html());
  });
  server.requestTimeout = 10000;
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  return {
    url: origin + path,
    pins: () => pins.map((p) => ({ ...p })),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
