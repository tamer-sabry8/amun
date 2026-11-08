/** Explicit M1 capabilities. Server annotations and naming prefixes grant no authority. */
export function notionToolPolicy(
  name: string,
): "read" | "approved-publish" | "blocked" {
  if (["notion-get-self", "notion-search", "notion-fetch"].includes(name))
    return "read";
  if (name === "notion-create-pages") return "approved-publish";
  return "blocked";
}
