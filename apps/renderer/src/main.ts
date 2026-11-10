async function start() {
  const mode = new URLSearchParams(location.search);
  if (mode.get("proof") === "1") {
    const [{ startProof }, { proofMarkup }] = await Promise.all([
      import("./proof.ts"),
      import("./proof-markup.ts"),
    ]);
    document.body.classList.add("proof-mode");
    document.body.innerHTML = proofMarkup;
    startProof();
  } else if (mode.get("gallery") === "1") {
    const { startGallery } = await import("./gallery.tsx");
    startGallery();
  } else {
    const { startShell } = await import("./shell.tsx");
    startShell();
  }
  window.postMessage({ kind: "amun-renderer-ready" }, "*");
}
void start().catch(() => {
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = "Amun could not load. Reopen the app to try again.";
  document.body.replaceChildren(message);
});
