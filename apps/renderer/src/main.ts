import { startGallery } from "./gallery.tsx";
import { startShell } from "./shell.tsx";
import { startProof } from "./proof.ts";
import { proofMarkup } from "./proof-markup.ts";
if (new URLSearchParams(location.search).get("proof") === "1") {
  document.body.classList.add("proof-mode");
  document.body.innerHTML = proofMarkup;
  startProof();
} else if (new URLSearchParams(location.search).get("gallery") === "1")
  startGallery();
else startShell();
