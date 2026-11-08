import { authBrowserUrl } from "../../../packages/auth/src/pi-auth.ts";
export function authBrowserArgs(
  provider: string,
  url: string,
  selectedHost?: string,
): string[] {
  return ["-a", "Microsoft Edge", authBrowserUrl(provider, url, selectedHost)];
}
