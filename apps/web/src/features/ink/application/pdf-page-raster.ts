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
