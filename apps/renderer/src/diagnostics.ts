import type { DiagnosticEvent } from "../../../packages/contracts/src/diagnostic.ts";

export function observeDiagnostics(send: (event: DiagnosticEvent) => void) {
  const record = (
    event: DiagnosticEvent["event"],
    subject: DiagnosticEvent["subject"],
    elapsedMs: number | null = null,
  ) => send({ version: 1, kind: "diagnostic", event, subject, elapsedMs });
  let started: { provider: DiagnosticEvent["subject"]; at: number } | undefined;
  document.addEventListener(
    "beforetoggle",
    (event) => {
      const dialog = event.target;
      if (
        !(dialog instanceof HTMLDialogElement) ||
        (event as ToggleEvent).newState !== "open"
      )
        return;
      const at = performance.now();
      const subject = dialog.classList.contains("auth-dialog")
        ? "auth"
        : dialog.classList.contains("command-palette")
          ? "search"
          : dialog.getAttribute("aria-label") === "Edit conversation draft"
            ? "draft"
            : "dialog";
      const login = subject === "auth" ? started : undefined;
      if (login) started = undefined;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!dialog.open || document.visibilityState !== "visible") return;
          const elapsed = (start: number) =>
            Math.round(performance.now() - start);
          record("dialog-frame", subject, elapsed(at));
          if (login)
            record("login-first-dialog", login.provider, elapsed(login.at));
        }),
      );
    },
    true,
  );
  window.addEventListener("error", () => record("renderer-error", "renderer"));
  window.addEventListener("unhandledrejection", () =>
    record("unhandled-rejection", "renderer"),
  );
  return {
    login(provider: DiagnosticEvent["subject"]) {
      started = { provider, at: performance.now() };
    },
    clear() {
      started = undefined;
    },
    failed(provider: DiagnosticEvent["subject"]) {
      record("provider-error", provider);
    },
  };
}
