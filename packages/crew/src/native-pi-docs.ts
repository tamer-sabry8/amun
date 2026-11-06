export function nativeDocumentPage(
  text: string,
  argument: string,
  title = "Pi changelog",
) {
  if (text.length > 2097152 || !/^(?:0|[1-9][0-9]{0,3})?$/.test(argument))
    throw Error("Invalid document page");
  const page = argument ? Number(argument) : 0,
    totalPages = Math.max(1, Math.ceil(text.length / 60000));
  if (page >= totalPages) throw Error("Document page unavailable");
  return {
    kind: "document" as const,
    title,
    text: text.slice(page * 60000, (page + 1) * 60000),
    page,
    totalPages,
  };
}
