/**
 * Client-side image compression: decode → downscale to a max dimension →
 * re-encode as WebP via canvas. Cuts multi-MB screenshots to tens of KB before
 * they hit storage. Falls back to JPEG when the browser can't encode WebP
 * (older Safari); the returned blob's `type` says which one you got.
 */

export interface CompressedImage {
  blob: Blob;
  /** "webp" | "jpeg" — matches the blob's actual encoding. */
  ext: string;
}

const MAX_DIM = 1600;
const QUALITY = 0.82;

export async function compressImage(
  file: File,
  { maxDim = MAX_DIM, quality = QUALITY }: { maxDim?: number; quality?: number } = {},
): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be attached.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");
    ctx.drawImage(bitmap, 0, 0, w, h);

    const webp = await toBlob(canvas, "image/webp", quality);
    if (webp?.type === "image/webp") return { blob: webp, ext: "webp" };
    const jpeg = await toBlob(canvas, "image/jpeg", quality);
    if (jpeg) return { blob: jpeg, ext: "jpeg" };
    throw new Error("Image encoding failed.");
  } finally {
    bitmap.close();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
