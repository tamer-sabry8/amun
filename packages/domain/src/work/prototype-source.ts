// A prototype a crew agent made is saved as a "prototype" output. Its body is
// either a page written as HTML (bare or in an ```html block) or a link to a
// local development server. Only these can be previewed.

export const prototypeType = "prototype";
export const maxPreviewHtml = 500_000;

export type PreviewSource =
  { kind: "html"; html: string } | { kind: "url"; url: string };

const localLink =
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#][^\s<>"')\]]*)?/i;
const fenced = /```html[^\S\n]*\n([\s\S]*?)\n```/i;
const wholePage = /^\s*(?:<!doctype\s+html|<html[\s>])/i;

/** What can be opened for this output, or null when there is nothing to open. */
export function previewSource(
  type: string,
  body: string,
): PreviewSource | null {
  if (type !== prototypeType) return null;
  const page = wholePage.test(body) ? body : fenced.exec(body)?.[1];
  if (page?.trim() && page.length <= maxPreviewHtml)
    return { kind: "html", html: page };
  const link = localLink.exec(body)?.[0];
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.username || url.password) return null;
    return { kind: "url", url: url.href };
  } catch {
    return null;
  }
}
