import { azurePathSegment } from "./path.ts";
export function projectSource<T extends { kind: string; baseUrl: string }>(
  reference: string,
  connections: readonly T[],
) {
  const url = new URL(reference);
  if (
    url.protocol !== "https:" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw Error("Invalid Azure project URL");
  const path = url.pathname.replace(/\/$/, "");
  const index = path.lastIndexOf("/");
  const project = decodeURIComponent(path.slice(index + 1));
  azurePathSegment(project);
  const collection = url.origin + path.slice(0, index + 1);
  const connection = connections.find(
    (c) =>
      c.kind === "ado" &&
      new URL(c.baseUrl).href.replace(/\/?$/, "/") === collection,
  );
  if (!connection)
    throw Error("Connect the mapped Azure collection in Settings.");
  return { connection, collection, project };
}
