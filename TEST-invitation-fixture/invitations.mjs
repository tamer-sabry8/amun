// Synthetic acceptance fixture. Not imported by the product or persisted to disk.
import { createServer } from "node:http";

export function createInvitationFixture() {
  const pending = new Map([["TEST-invite", "TEST-recipient-token"]]);
  return createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const send = (status, body, type = "text/plain") => {
      response.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
      });
      response.end(body);
    };
    if (
      url.pathname === "/TEST/dashboard" ||
      url.pathname.startsWith("/TEST/admin/invitations/")
    ) {
      // Local synthetic session credential; never a product authentication mechanism.
      if (request.headers.authorization !== "Bearer TEST-admin-session") {
        send(403, "Forbidden");
        return;
      }
      if (request.method === "GET" && url.pathname === "/TEST/dashboard") {
        const rows = [...pending.keys()]
          .map(
            (id) =>
              `<li>${id} <button data-id="${id}">Revoke invitation</button></li>`,
          )
          .join("");
        send(
          200,
          `<!doctype html><html lang="en"><title>TEST pending invitations</title><h1>Pending invitations</h1><ul>${rows}</ul><p role="status"></p><script>
 document.querySelectorAll('button').forEach(button => button.onclick = async () => {
   const result = await fetch('/TEST/admin/invitations/' + button.dataset.id, {method: 'DELETE', headers: {Authorization: 'Bearer TEST-admin-session'}});
   if (result.ok) { button.closest('li').remove(); document.querySelector('[role=status]').textContent = 'Invitation revoked'; }
 });
 </script></html>`,
          "text/html; charset=utf-8",
        );
        return;
      }
      if (
        request.method === "DELETE" &&
        url.pathname.startsWith("/TEST/admin/invitations/")
      ) {
        const id = url.pathname.slice("/TEST/admin/invitations/".length);
        send(pending.delete(id) ? 204 : 404, "");
        return;
      }
    }
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/TEST/invitations/")
    ) {
      const token = url.pathname.slice("/TEST/invitations/".length);
      send(
        [...pending.values()].includes(token) ? 200 : 404,
        [...pending.values()].includes(token)
          ? "TEST invitation available"
          : "Invitation unavailable",
      );
      return;
    }
    send(404, "Not found");
  });
}
