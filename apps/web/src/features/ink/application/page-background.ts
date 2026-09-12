/**
 * A page background from a file (§4.8, §5 of the explorer plan): a PDF page
 * or an image, laid on an A4 sheet.
 *
 * Every ink page is A4 — `INK_A4_WIDTH × INK_A4_HEIGHT` — so a note prints
 * as it is drawn and a stack of pages is one paper size. A source of another
 * shape is not stretched to fit: it is scaled to sit inside the sheet,
 * centred, on white. The placement is a pure function so a test can check it
 * without a canvas.
 */

import { INK_A4_HEIGHT, INK_A4_WIDTH } from "@weaveforge/core";

import {
  createCanvas,
  renderPdfPage,
  toPngBlob,
} from "./pdf-page-raster";

/** The sheet's raster: A4 at 200 dpi, 1654 × 2339. */
export const A4_RASTER_WIDTH = 1654;
export const A4_RASTER_HEIGHT = Math.round(
  (A4_RASTER_WIDTH * INK_A4_HEIGHT) / INK_A4_WIDTH,
);

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a `sourceWidth × sourceHeight` image sits on a `sheetWidth ×
 * sheetHeight` sheet: as large as fits without cropping, centred on the
 * axis it does not fill. A source that fits already is not enlarged past
 * the sheet — it is scaled up to the sheet, since a background is meant to
 * cover the page.
 */
export function placeOnSheet(
  sourceWidth: number,
  sourceHeight: number,
  sheetWidth: number = A4_RASTER_WIDTH,
  sheetHeight: number = A4_RASTER_HEIGHT,
): Placement {
  const w = Math.max(1, sourceWidth);
  const h = Math.max(1, sourceHeight);
  const scale = Math.min(sheetWidth / w, sheetHeight / h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return {
    x: Math.round((sheetWidth - width) / 2),
    y: Math.round((sheetHeight - height) / 2),
    width,
    height,
  };
}

/** Whether `file` is something this can make a page of. */
export function isPageSource(file: { type: string; name: string }): boolean {
  return isPdf(file) || file.type.startsWith("image/");
}

export function isPdf(file: { type: string; name: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * The A4 PNG for `file`: page `pdfPage` of a PDF, or the image itself. The
 * caller has already asked which page, when there is a choice.
 */
export async function pageBackgroundFromFile(
  file: File,
  pdfPage = 1,
): Promise<Blob> {
  if (isPdf(file)) {
    const bytes = await file.arrayBuffer();
    // Rendered at the sheet's width; a landscape page is then scaled down
    // to fit, which loses nothing at 200 dpi.
    const page = await renderPdfPage(bytes, pdfPage, A4_RASTER_WIDTH);
    return composeOnSheet(page, page.width, page.height);
  }
  if (typeof createImageBitmap !== "function")
    throw new Error("Images cannot be decoded here.");
  const image = await createImageBitmap(file);
  try {
    return await composeOnSheet(image, image.width, image.height);
  } finally {
    image.close();
  }
}

async function composeOnSheet(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob> {
  const sheet = createCanvas(A4_RASTER_WIDTH, A4_RASTER_HEIGHT);
  const context = sheet.getContext("2d") as CanvasRenderingContext2D | null;
  if (!context) throw new Error("A 2D context could not be created for the page.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, A4_RASTER_WIDTH, A4_RASTER_HEIGHT);
  const box = placeOnSheet(width, height);
  context.drawImage(source, box.x, box.y, box.width, box.height);
  return toPngBlob(sheet);
}
