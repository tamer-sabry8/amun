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
  action: "navigate" | "back" | "forward" | "reload" | "close" | "scope";
  url?: string;
  product?: string;
};
export function browserCommand(value: unknown): BrowserCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.action === "scope" &&
    Object.keys(record).length === 2 &&
    typeof record.product === "string" &&
    record.product.length > 0 &&
    record.product.length <= 256 &&
    !/[\u0000-\u001f]/.test(record.product)
  )
    return { action: "scope", product: record.product };
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

export function browserLayout(
  input: unknown,
  width: number,
  height: number,
): {
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
} | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 3 ||
    value.action !== "layout" ||
    typeof value.visible !== "boolean" ||
    !value.bounds ||
    typeof value.bounds !== "object" ||
    Array.isArray(value.bounds)
  )
    return null;
  const b = value.bounds as Record<string, unknown>;
  if (
    Object.keys(b).length !== 4 ||
    ["x", "y", "width", "height"].some(
      (key) => typeof b[key] !== "number" || !Number.isFinite(b[key]),
    )
  )
    return null;
  const bounds = {
    x: Math.round(b.x as number),
    y: Math.round(b.y as number),
    width: Math.round(b.width as number),
    height: Math.round(b.height as number),
  };
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width < 1 ||
    bounds.height < 1 ||
    bounds.x + bounds.width > width ||
    bounds.y + bounds.height > height
  )
    return null;
  return { visible: value.visible, bounds };
}
