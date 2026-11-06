type ElementState = {
  textContent: string | null;
  replaceChildren?: () => void;
};
export function resetServiceUI(
  find: (id: string) => ElementState | null,
  terminal: { options: { disableStdin?: boolean } },
): void {
  terminal.options.disableStdin = true;
  find("pi-dialog")?.replaceChildren?.();
  for (const id of ["pi-status", "terminal-status"]) {
    const label = find(id);
    if (label) label.textContent = "unavailable";
  }
}
