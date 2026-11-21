import type { AzureProcessSchema } from "../../contracts/src/backlog.ts";
export type FieldValues = Record<string, string | number | boolean>;
export function requiredInputs(
  type: AzureProcessSchema["types"][number],
  values: FieldValues,
) {
  const aliases: Record<string, string> = {
    "System.AreaId": "System.AreaPath",
    "System.IterationId": "System.IterationPath",
  };
  return type.fields
    .filter((f) => {
      if (!f.required) return false;
      const key = aliases[f.referenceName] ?? f.referenceName;
      const value = Object.hasOwn(values, key) ? values[key] : f.defaultValue;
      return value == null || (typeof value === "string" && !value.trim());
    })
    .map((f) => f.referenceName);
}

/** Render the Amun draft as Azure rich text once, before binding the preview. */
export function storyTextFields(
  fields: { referenceName: string }[],
  body: string,
  acceptance: string[],
): Record<string, string> {
  const names = new Set(fields.map((field) => field.referenceName));
  const description = "System.Description";
  const dedicated = "Microsoft.VSTS.Common.AcceptanceCriteria";
  const escape = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const lines = body.split(/\r?\n/);
  const criteria = [
    ...new Set(acceptance.map((text) => text.trim()).filter(Boolean)),
  ];
  const list = (entries: string[]) =>
    "<ul>" +
    entries.map((text) => "<li>" + escape(text) + "</li>").join("") +
    "</ul>";
  const result: Record<string, string> = {};
  if (names.has(description))
    result[description] = "<p>" + lines.map(escape).join("<br>") + "</p>";
  if (!criteria.length) return result;
  if (names.has(dedicated)) return { ...result, [dedicated]: list(criteria) };
  if (!names.has(description))
    throw Error("No Azure field is available for the acceptance criteria.");
  const heading = lines.findIndex((line) =>
    /^\s*(?:#{1,6}\s+)?acceptance criteria\s*:?\s*$/i.test(line),
  );
  if (heading < 0) {
    result[description] += "<h3>Acceptance criteria</h3>" + list(criteria);
    return result;
  }
  let end = heading + 1;
  while (
    end < lines.length &&
    !/^(?:#{1,6}\s+|\s*[A-Z][^.!?:]{0,60}:\s*$)/.test(lines[end]!)
  )
    end++;
  const existing = new Set(
    lines
      .slice(heading + 1, end)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()),
  );
  const added = criteria.filter((text) => !existing.has(text));
  if (added.length) {
    const before = lines.slice(0, end).map(escape).join("<br>");
    const after = lines.slice(end).map(escape).join("<br>");
    result[description] =
      "<p>" +
      before +
      "</p>" +
      list(added) +
      (after ? "<p>" + after + "</p>" : "");
  }
  return result;
}

/** Preserve the original provider HTML byte-for-byte around the insertion. */
export function appendAzureCriteria(
  html: string,
  criteria: string[],
  description: boolean,
) {
  const escape = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const heading =
    /<h([1-6])\b[^>]*>\s*Acceptance criteria\s*:?\s*<\/h\1>/i.exec(html);
  const start = description && heading ? heading.index + heading[0].length : 0;
  const rest = html.slice(start);
  const next = description && heading ? rest.search(/<h[1-6]\b/i) : -1;
  const end = next < 0 ? html.length : start + next;
  const section = description && !heading ? "" : html.slice(start, end);
  const existing = new Set(
    [...section.matchAll(/<(?:li|p)\b[^>]*>([\s\S]*?)<\/(?:li|p)>/gi)].map(
      (m) => m[1]!.replace(/<[^>]+>/g, "").trim(),
    ),
  );
  const added = [
    ...new Set(criteria.map((c) => escape(c.trim())).filter(Boolean)),
  ].filter((c) => !existing.has(c));
  if (!added.length) return html;
  const list = added.map((c) => "<li>" + c + "</li>").join("");
  const closing = section.toLowerCase().lastIndexOf("</ul>");
  if (closing >= 0)
    return html.slice(0, start + closing) + list + html.slice(start + closing);
  return (
    html.slice(0, end) +
    (description && !heading ? "<h3>Acceptance criteria</h3>" : "") +
    "<ul>" +
    list +
    "</ul>" +
    html.slice(end)
  );
}
