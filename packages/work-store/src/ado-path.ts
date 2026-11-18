export function azurePathSegment(value: string) {
  if (
    !value.trim() ||
    value === "." ||
    value === ".." ||
    /[\\/\x00-\x1f]/.test(value)
  )
    throw new Error("Invalid Azure scope");
  return encodeURIComponent(value);
}
