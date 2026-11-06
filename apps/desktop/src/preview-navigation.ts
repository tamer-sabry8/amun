import { browserURL } from "./browser-policy.ts";
const identityHosts = new Set([
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
]);
/** Known federated providers only; never claims detection of arbitrary custom SSO. */
export function previewDecision(
  raw: unknown,
  mainFrame: boolean,
): "allow" | "handoff" | "block" {
  const safe = browserURL(raw);
  if (!safe) return "block";
  const host = new URL(safe).hostname.toLowerCase().replace(/\.$/, "");
  return identityHosts.has(host) ? (mainFrame ? "handoff" : "block") : "allow";
}
/** One window-owned ephemeral capability; URL never comes from the open request. */
export class HandoffSlot {
  private pending: { id: string; url: string; expires: number } | undefined;
  private lastOpen = -Infinity;
  constructor(
    private clock: () => number,
    private mint: () => string,
  ) {}
  offer(url: string): string | null {
    this.clear();
    const safe = browserURL(url);
    if (!safe) return null;
    const id = this.mint();
    this.pending = { id, url: safe, expires: this.clock() + 60000 };
    return id;
  }
  clear(): void {
    this.pending = undefined;
  }
  open(id: unknown): string | null {
    const p = this.pending;
    const now = this.clock();
    if (!p || p.id !== id || now > p.expires || now - this.lastOpen < 2000)
      return null;
    this.clear();
    this.lastOpen = now;
    return p.url;
  }
}
