export function colorHex(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    !("colorSpace" in value) ||
    value.colorSpace !== "srgb" ||
    !("components" in value) ||
    !Array.isArray(value.components) ||
    value.components.length !== 3 ||
    value.components.some(
      (component) =>
        typeof component !== "number" ||
        !Number.isFinite(component) ||
        component < 0 ||
        component > 1,
    ) ||
    ("alpha" in value && value.alpha !== 1)
  )
    throw Error("Expected opaque sRGB colour");
  return (
    "#" +
    (value.components as number[])
      .map((component) =>
        Math.round(component * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    if (!/^#[a-fA-F0-9]{6}$/.test(hex)) throw Error("Expected hex colour");
    const values = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      );
    return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
  };
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
