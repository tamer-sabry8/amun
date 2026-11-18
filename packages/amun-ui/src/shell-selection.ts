export type ShellChoice = "proof" | "gallery" | "legacy" | "rebuilt";

/**
 * The legacy shell is test-only and must not ship: a packaged build (the main
 * process adds ?packaged=1) always renders the rebuilt shell.
 */
export function chooseShell(search: string): ShellChoice {
  const mode = new URLSearchParams(search);
  if (mode.get("proof") === "1") return "proof";
  if (mode.get("packaged") === "1") return "rebuilt";
  if (mode.get("gallery") === "1") return "gallery";
  if (mode.get("legacy") === "1") return "legacy";
  return "rebuilt";
}
