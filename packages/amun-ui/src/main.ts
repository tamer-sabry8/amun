import { chooseShell } from "./shell-selection.ts";
import { installDaemonPort } from "./daemon/daemon-port.ts";
async function start() {
  const shell = chooseShell(location.search);
  if (shell !== "gallery") installDaemonPort();
  if (shell === "proof") {
    const [{ startProof }, { proofMarkup }] = await Promise.all([
      import("./proof.ts"),
      import("./proof-markup.ts"),
    ]);
    document.body.classList.add("proof-mode");
    document.body.innerHTML = proofMarkup;
    startProof();
  } else if (shell === "gallery") {
    const { startGallery } = await import("./gallery.tsx");
    startGallery();
  } else if (shell === "legacy") {
    // Test-only: the earlier shell still drives the unmigrated e2e specs. It
    // is unreachable in packaged builds (see shell-selection.ts) and must not ship.
    const { startShell } = await import("./shell.tsx");
    startShell();
  } else {
    const { startRebuiltShell } = await import("./rebuild/app.tsx");
    startRebuiltShell();
  }
  window.postMessage({ kind: "amun-renderer-ready" }, "*");
}
void start().catch(() => {
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "Amun could not load. Reopen the app to try again.";
  document.body.replaceChildren(message);
});
