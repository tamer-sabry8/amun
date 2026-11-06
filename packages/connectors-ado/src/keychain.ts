import { AsyncEntry } from "@napi-rs/keyring";
export const adoCredential = () =>
  new AsyncEntry("ai.amun", "m0/ado/devops.tahaluf.ae/TahalufCollection/ICV");
export function validatePat(value: string): string {
  if (value.length < 20 || value.length > 512 || !/^[A-Za-z0-9]+$/.test(value))
    throw new Error("Invalid PAT format");
  return value;
}
