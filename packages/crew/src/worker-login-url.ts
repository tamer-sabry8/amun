export function officialWorkerLoginUrl(
  tool: "claude" | "codex",
  output: string,
): string | undefined {
  if (output.length > 65536) return;
  const host = tool === "claude" ? "claude.com" : "auth.openai.com";
  const path = tool === "claude" ? "/cai/oauth/authorize" : "/oauth/authorize";
  for (const match of output.matchAll(/https:\/\/[^\s\u001b<>"']+/g)) {
    try {
      const url = new URL(match[0]);
      if (
        url.protocol === "https:" &&
        url.hostname === host &&
        url.pathname === path &&
        !url.port &&
        !url.username &&
        !url.password &&
        !url.hash
      )
        return url.href;
    } catch {
      /* Ignore non-URL CLI text. */
    }
  }
}
/** In-memory only: OAuth URLs are passed directly to the trusted browser opener, never logged. */
export class WorkerLoginBrowser {
  private buffer = "";
  private opened = false;
  constructor(
    private tool: "claude" | "codex",
    private open: (url: string) => void,
  ) {}
  receive(chunk: string): void {
    if (this.opened) return;
    this.buffer = (this.buffer + chunk).slice(-65536);
    // Wait for the terminating whitespace so split chunks cannot open an incomplete OAuth URL.
    const complete = this.buffer.slice(
      0,
      Math.max(this.buffer.lastIndexOf("\n"), this.buffer.lastIndexOf(" ")) + 1,
    );
    const url = officialWorkerLoginUrl(this.tool, complete);
    if (url) {
      this.opened = true;
      this.buffer = "";
      this.open(url);
    }
  }
}
