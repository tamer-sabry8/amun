// The sign-in prompt dialog, shared by the earlier shell and the rebuilt one.
// Kept in its own module so the rebuilt shell does not load the earlier shell
// at startup just to show it.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bridge } from "./bridge.ts";
import { canSubmitAuthPrompt } from "./auth-prompt.ts";

export function AuthPrompt() {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const [value, setValue] = useState("");
  const prompt = state.prompt;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    setValue("");
    if (prompt && !dialog.current?.open) dialog.current?.showModal();
    if (!prompt && dialog.current?.open) dialog.current.close();
  }, [prompt?.id]);
  const cancel = () => {
    bridge.send({ version: 1, kind: "auth", action: "cancel" });
    bridge.clearPrompt();
    setValue("");
  };
  return (
    <dialog
      className="auth-dialog"
      ref={dialog}
      aria-labelledby="auth-title"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      {prompt && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            bridge.send({
              version: 1,
              kind: "auth",
              action: "answer",
              id: prompt.id,
              answer: value,
            });
            setValue("");
            bridge.clearPrompt();
          }}
        >
          <h2 id="auth-title">Complete sign-in</h2>
          <label>
            {prompt.message}
            {prompt.method === "select" ? (
              <select
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                <option value="">Choose an option</option>
                {prompt.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus
                autoComplete="off"
                type={
                  prompt.method === "secret" || prompt.method === "manual_code"
                    ? "password"
                    : "text"
                }
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={65536}
              />
            )}
          </label>
          {prompt.method === "text" &&
          prompt.message ===
            "GitHub Enterprise URL/domain (blank for github.com)" ? (
            <p className="muted">
              Copilot signs in through github.com or your company’s
              tenant.ghe.com host. Your repository server may use a different
              address. Enter only the sign-in host, without an /enterprises
              path. Authorization opens in Microsoft Edge.
            </p>
          ) : (
            <p className="muted">
              Enter credentials only here or in the provider’s browser page.
              Browser authorization opens in Microsoft Edge.
            </p>
          )}
          <div className="button-row">
            <button
              className="primary"
              disabled={!canSubmitAuthPrompt(prompt, value)}
            >
              Continue
            </button>
            <button type="button" onClick={cancel}>
              Cancel sign-in
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
