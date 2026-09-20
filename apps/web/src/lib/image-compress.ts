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

/**
 * Files at or below this are left alone when they are already in a format we
 * would have produced.
 *
 * The trade, stated plainly: a 40 KB WebP screenshot is decoded, redrawn and
 * re-encoded to save a few kilobytes and lose a little quality, and everything
 * in between is CPU the person who dropped the file waits for. Below this size
 * the original bytes are kept instead.
 *
 * What is given up: a file that is small *and* enormous in pixels keeps its
 * full resolution, because knowing the dimensions requires the decode this is
 * avoiding. Storage is the only cost — the file is already small, and the note
 * renders it scaled — so it is the cheap side of the trade.
 */
const KEEP_ORIGINAL_BELOW_BYTES = 64 * 1024;

/** Formats we already prefer: nothing to gain from re-encoding a small one. */
const ALREADY_OPTIMAL = new Set(["image/webp", "image/jpeg"]);

/**
 * Whether the file can be stored as it came.
 *
 * Pure, and separate from the decode, so the decision can be tested without a
 * canvas — which is the only way anything in this module is testable.
 */
export function canStoreUnchanged(file: { type: string; size: number }): boolean {
  return ALREADY_OPTIMAL.has(file.type) && file.size <= KEEP_ORIGINAL_BELOW_BYTES;
}

export async function compressImage(
  file: File,
  { maxDim = MAX_DIM, quality = QUALITY }: { maxDim?: number; quality?: number } = {},
): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be attached.");
  }
  if (canStoreUnchanged(file)) {
    return { blob: file, ext: file.type === "image/webp" ? "webp" : "jpeg" };
  }
  // `imageOrientation: "from-image"` is what applies a phone photo's EXIF
  // rotation. It is the spec default in current engines, so this changes nothing
  // there — it is written out so the behaviour does not depend on a default, and
  // the fallback keeps a browser that does not know the option working.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() =>
    createImageBitmap(file),
  );
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
