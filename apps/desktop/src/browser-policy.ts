export function browserURL(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    /[\s\\\u0000-\u001f\u007f]/u.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function browserPartition(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw new Error("Invalid browser product scope");
  return `persist:amun-browser-${value}`;
}
export type BrowserCommand = {
  action: "navigate" | "back" | "forward" | "reload" | "close";
  url?: string;
};
export function browserCommand(value: unknown): BrowserCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.action === "navigate" && Object.keys(record).length === 2) {
    const url = browserURL(record.url);
    return url ? { action: "navigate", url } : null;
  }
  if (
    Object.keys(record).length === 1 &&
    ["back", "forward", "reload", "close"].includes(String(record.action))
  )
    return { action: record.action as BrowserCommand["action"] };
  return null;
}
