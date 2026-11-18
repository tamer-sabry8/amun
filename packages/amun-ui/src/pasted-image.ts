/** Re-encode only decoded pixels before previewing or sending clipboard image data. */
export async function pastedImage(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 4194304
  )
    throw Error("Unsupported image");
  const bitmap = await createImageBitmap(file);
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 16777216
    )
      throw Error("Image is too large");
    const ratio = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Image unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/png");
    if (url.length > 350000) throw Error("Image is too large");
    return url.slice("data:image/png;base64,".length);
  } finally {
    bitmap.close();
  }
}
