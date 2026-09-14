/**
 * A PDF page as a page background (§4.8): one page rasterised to a PNG the
 * vault keeps as an attachment. `lib/pdf-lib` is the shared loader, so the
 * bundle is fetched once on either feature's first use.
 */

import { loadPdfLib } from "@/lib/pdf-lib";

export interface RasterisedPdfPage {
  blob: Blob;
  /** The raster's size in pixels; the aspect is the page's. */
  width: number;
  height: number;
}

/** How many pages the document has, so the prompt can bound the answer. */
export async function pdfPageCount(bytes: ArrayBuffer): Promise<number> {
  const lib = await loadPdfLib();
  const pdf = await lib.getDocument({ data: copyOf(bytes) }).promise;
  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy();
  }
}

/**
 * Render page `pageNumber` (1-based) at `widthPx` wide. The background is
 * stretched to the ink page, so the width only sets the raster's sharpness;
 * an A4 page at 2100 units of 0.1 mm is 1654 px at 200 dpi.
 */
export async function rasterisePdfPage(
  bytes: ArrayBuffer,
  pageNumber: number,
  widthPx: number,
): Promise<RasterisedPdfPage> {
  const canvas = await renderPdfPage(bytes, pageNumber, widthPx);
  const blob = await toPngBlob(canvas);
  return { blob, width: canvas.width, height: canvas.height };
}

/** The page drawn on a canvas, for a caller that composes it before encoding. */
export async function renderPdfPage(
  bytes: ArrayBuffer,
  pageNumber: number,
  widthPx: number,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const lib = await loadPdfLib();
  const pdf = await lib.getDocument({ data: copyOf(bytes) }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: widthPx / base.width });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context)
      throw new Error("A 2D context could not be created for the PDF page.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas;
  } finally {
    await pdf.destroy();
  }
}

/**
 * pdf.js transfers the buffer it is given to its worker, which detaches the
 * caller's copy. A page count followed by a render must each hand over their
 * own, or the second `Uint8Array` is built on a detached buffer and throws.
 */
function copyOf(bytes: ArrayBuffer): Uint8Array {
  return new Uint8Array(bytes.slice(0));
}

export function createCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return new OffscreenCanvas(width, height);
}

export function toPngBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas)
    return canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The PDF page could not be encoded as PNG."));
    }, "image/png");
  });
}

/**
 * A WebP blob for content that is looked at rather than re-composed: figures,
 * not page rasters. WebP at quality 0.9 is half to two-thirds the size of PNG
 * for photos and screenshots, which is most of what gets pasted onto a page.
 *
 * Chromium's canvas cannot encode *lossless* WebP, so this is lossy — which
 * is why a page background, the layer pen strokes are written over and the
 * note prints from, stays PNG: a lossy artefact would sit under every stroke.
 * A figure sits *on* the page like a photograph pasted in a notebook, and a
 * q=0.9 WebP of one is indistinguishable in place at half the bytes.
 *
 * The blob is verified rather than trusted: Safari's canvas answers a WebP
 * request with a PNG blob, and a `.webp` name on PNG bytes is a note that
 * some reader, somewhere, refuses to open. When the answer is not WebP, the
 * caller is told so through the returned type and names the file honestly.
 */
export async function toWebpBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<{ blob: Blob; type: "image/webp" | "image/png" }> {
  const want = "image/webp";
  const blob =
    "convertToBlob" in canvas
      ? await canvas.convertToBlob({ type: want, quality: 0.9 })
      : await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, want, 0.9),
        );
  if (!blob) throw new Error("The image could not be encoded.");
  // A browser that cannot encode WebP falls back to PNG silently; the name
  // must follow the bytes, not the request.
  return { blob, type: blob.type === want ? want : "image/png" };
}
