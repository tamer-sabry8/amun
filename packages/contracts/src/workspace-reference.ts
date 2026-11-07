// A directory completion leaves a quoted reference open for the next path component.
export function trailingWorkspaceReference(draft: string) {
  const match = /(?:^|\s)(@(?:"((?:[^"\\\r\n]|\\["\\])*)|([^@"\s]*)))$/u.exec(
    draft,
  );
  if (!match) return null;
  return {
    prefix: match[2]?.replace(/\\(["\\])/g, "$1") ?? match[3]!,
    start: draft.length - match[1]!.length,
  };
}
export function workspaceDirectoryReference(path: string) {
  return /[\s@"\\]/u.test(path)
    ? "@" + JSON.stringify(path).slice(0, -1)
    : "@" + path;
}
