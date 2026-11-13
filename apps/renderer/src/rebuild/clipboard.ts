// Copying text. The app refuses every web permission, the clipboard's
// included, so the modern clipboard call is rejected here. Copying a selected
// field in answer to a click needs no permission and works everywhere, so it
// is the fallback. Returns whether the text reached the clipboard.
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fall through to the selection copy.
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  const focused = document.activeElement as HTMLElement | null;
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  field.remove();
  focused?.focus();
  return copied;
}
