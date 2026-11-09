import { AsyncEntry } from "@napi-rs/keyring";
import { projectSource } from "./project-source.ts";

/** Resolve only the pilot credential matching this exact project URL. */
export function pilotConnection() {
  const target = new URL(process.env.AMUN_ADO_PROJECT_URL ?? "");
  const reference = target.href.replace(/\/$/, "");
  const { collection, project } = projectSource(reference, [
    { kind: "ado", baseUrl: new URL(".", reference).href },
  ]);
  const account =
    "m0/ado/" + new URL(reference).host + new URL(reference).pathname;
  return {
    collection,
    project,
    credential: new AsyncEntry("ai.amun", account),
  };
}
