import type { NativePiResult } from "./native-pi.ts";
const inventory = new Map<string, readonly [string, string]>([
  ["github-connect", ["GitHub · Sign in with Microsoft Edge", ""]],
  ["github-read", ["GitHub · Test saved connection", ""]],
  ["github", ["GitHub · Check sign-in endpoint", ""]],
  [
    "gmail",
    [
      "Gmail",
      "Hosted Google Workspace MCP requires an authorized Google Cloud project and desktop OAuth registration.",
    ],
  ],
  [
    "drive",
    [
      "Google Drive",
      "Use the hosted Google Workspace connector. The archived Drive server is not enabled.",
    ],
  ],
  [
    "sheets",
    [
      "Google Sheets",
      "Connect through the hosted Sheets MCP with the selected Google account. Setup pending.",
    ],
  ],
  [
    "calendar",
    ["Google Calendar", "Hosted Calendar MCP requires Google Workspace setup."],
  ],
  [
    "maps",
    [
      "Google Maps",
      "The requested server is archived. A supported replacement needs separate verification.",
    ],
  ],
  [
    "playwright",
    [
      "Playwright",
      "Requires a pinned local adapter and a separate test browser profile.",
    ],
  ],
  [
    "chrome",
    [
      "Chrome DevTools",
      "Uses a separate Chrome profile. Packaged connection setup pending.",
    ],
  ],
  [
    "puppeteer",
    [
      "Puppeteer",
      "The requested adapter is archived. Disabled pending compatibility review.",
    ],
  ],
  [
    "filesystem",
    [
      "Local disk and external drives",
      "Choose a folder before granting access. No disk or folder is currently granted by this control.",
    ],
  ],
  [
    "obsidian",
    ["Obsidian", "Requires Obsidian, its companion plugin and a chosen vault."],
  ],
  [
    "docker",
    [
      "Docker MCP Registry",
      "The registry is a catalog. Choose a specific server before connecting.",
    ],
  ],
  [
    "cloudflare",
    [
      "Cloudflare documentation",
      "Documentation access only; account management is a separate connection.",
    ],
  ],
  [
    "notion",
    [
      "Notion",
      "Managed in Settings → Connections by Amun. Pi does not receive this grant.",
    ],
  ],
]);
export async function nativeMcp(
  key: string,
  request: typeof fetch = fetch,
): Promise<NativePiResult> {
  if (!key)
    return {
      kind: "choices",
      title: "MCP connections and setup",
      choices: [...inventory].map(([id, [label]]) => ({ id, label })),
    };
  const entry = inventory.get(key);
  if (!entry) throw Error("Unknown connector");
  if (key !== "github") return { kind: "message", text: entry[1] };
  const response = await request("https://api.githubcopilot.com/mcp/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        clientInfo: { name: "amun", version: "1" },
        capabilities: {},
      },
    }),
  });
  await response.body?.cancel();
  const expected =
    response.status === 401 &&
    /^Bearer\s/i.test(response.headers.get("www-authenticate") ?? "") &&
    (response.headers.get("www-authenticate") ?? "").includes(
      'resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"',
    );
  return {
    kind: "message",
    text: expected
      ? "GitHub endpoint reachable. Sign-in required. This check grants no repository access."
      : "GitHub authorization endpoint not verified. No repository access was requested.",
  };
}
