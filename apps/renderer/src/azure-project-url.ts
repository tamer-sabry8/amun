/**
 * The project URL a backlog is mapped from, e.g.
 * https://devops.tahaluf.ae/TahalufCollection/POCs. Mirrors what the Azure
 * connector accepts, so a mistake is caught here instead of at the first load.
 */
export function azureProjectUrl(
  input: string,
): { ok: true; url: string; project: string } | { ok: false; error: string } {
  const text = input.trim();
  if (!text)
    return { ok: false, error: "Paste the Azure DevOps project address." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return {
      ok: false,
      error: "That is not a web address. Start it with https://.",
    };
  }
  if (url.protocol !== "https:")
    return { ok: false, error: "The address must start with https://." };
  if (url.username || url.password || url.search || url.hash)
    return {
      ok: false,
      error:
        "Use the plain project address, without a login, question mark or #.",
    };
  const path = url.pathname.replace(/\/$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2)
    return {
      ok: false,
      error:
        "Add the collection and project, like https://devops.example.com/Collection/Project.",
    };
  let project: string;
  try {
    project = decodeURIComponent(segments.at(-1)!);
  } catch {
    return { ok: false, error: "The project name in the address is invalid." };
  }
  if (project === "." || project === ".." || /[\\/\x00-\x1f]/.test(project))
    return { ok: false, error: "The project name in the address is invalid." };
  return { ok: true, url: url.origin + path, project };
}
