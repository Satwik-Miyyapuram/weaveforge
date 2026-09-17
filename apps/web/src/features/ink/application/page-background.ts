/**
 * A page background from a file (§4.8, §5 of the explorer plan): a PDF page
 * or an image, laid on an A4 sheet.
 *
 * Every ink page is A4 — `INK_A4_WIDTH × INK_A4_HEIGHT` — so a note prints
 * as it is drawn and a stack of pages is one paper size. A source of another
 * shape is not stretched to fit: it is scaled to sit inside the sheet,
 * centred, on white. The placement is a pure function so a test can check it
 * without a canvas.
 *
 * The other half of the same subject is here too: the chunk a page is written
 * with when its background changes (§4.8's mirror of the text layer's
 * `![page background](vault:…)` in the sidecar's header) and the clipboard
 * payload a pasted screenshot arrives in.
 */

import {
  INK_A4_HEIGHT,
  INK_A4_WIDTH,
  blankInkPage,
  clampInkPageSize,
  decodeInkChunk,
  encodeInkChunk,
  pageFromChunk,
  type InkChunkCodec,
  type InkPaper,
} from "@weaveforge/core";

import {
  createCanvas,
  renderPdfPage,
  toPngBlob,
  toWebpBlob,
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

/**
 * An image file as an attachment of its *own* size — a figure, not a page.
 *
 * A page background is composed onto an A4 sheet because it is the page; a
 * figure is content placed *on* a page, so its bytes keep the image's own
 * shape and size and the placement is the note's text (§figure).
 *
 * The encoding is WebP where the browser can make one — half to two-thirds
 * of PNG for the photos and screenshots that get pasted in — and PNG where it
 * cannot. Safari's canvas answers a WebP request with PNG bytes, so the
 * extension follows what the bytes really are, never the request. Quality
 * 0.9 lossy is fine here: a figure sits on the page like a photograph pasted
 * in a notebook, it is not the layer the pen writes over.
 */
export async function figureImageFromFile(
  file: File,
): Promise<{ blob: Blob; ext: "webp" | "png" }> {
  if (isPdf(file)) throw new Error("A PDF is a page, not a figure.");
  if (typeof createImageBitmap !== "function")
    throw new Error("Images cannot be decoded here.");
  const image = await createImageBitmap(file);
  try {
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) throw new Error("A 2D context could not be created for the image.");
    context.drawImage(image, 0, 0);
    const { blob, type } = await toWebpBlob(canvas);
    return { blob, ext: type === "image/webp" ? "webp" : "png" };
  } finally {
    image.close();
  }
}

/**
 * An image file's pixel size, for a figure's first box: the placement is
 * chosen from the image's own aspect, so a portrait photo does not land in a
 * landscape frame.
 */
export async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const image = await createImageBitmap(file);
  try {
    return { width: image.width, height: image.height };
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

/* -------------------------------------------------------------------------
 * The same fact in the sidecar's header
 * ---------------------------------------------------------------------- */

export interface PageBackgroundChunkOptions {
  /**
   * The 1-based attachment index for the page, or `0` for none — what
   * `inkAttachmentIndex` answers for the body the text layer made.
   */
  background: number;
  /** The page's paper, kept as the chunk had it. */
  paper: InkPaper;
  /**
   * The sheet to open with when the page has no chunk yet, in 0.1 mm. An
   * inserted PDF page keeps its own aspect ratio, so this is the page's size
   * and not always A4.
   */
  size?: { width: number; height: number };
  /** The codec the page's chunk is stored with; identity when absent. */
  codec?: InkChunkCodec;
}

/**
 * A page's chunk with its background set — strokes, lines and paper kept.
 *
 * The page's geometry comes from the chunk it already has, decoded and packed
 * again through core, so a background change cannot disturb a stroke: the only
 * field this decides is `background`. A page with no chunk yet is a blank one
 * at `size` (A4 when the caller does not say), which is the page an inserted
 * image becomes.
 *
 * This runs on the main thread on purpose. It is a background change — an
 * upload, a re-raster and a prompt already stand in front of it — and never
 * the pen path, which is the only place §6.2.2 forbids the work.
 */
export async function pageChunkWithBackground(
  chunk: Uint8Array | null,
  options: PageBackgroundChunkOptions,
): Promise<Uint8Array> {
  const { background, paper, size, codec } = options;
  const page = chunk
    ? pageFromChunk(await decodeInkChunk(chunk, codec))
    : {
        ...blankInkPage(paper),
        ...clampInkPageSize(
          size?.width ?? INK_A4_WIDTH,
          size?.height ?? INK_A4_HEIGHT,
        ),
      };
  return encodeInkChunk(
    {
      ...page,
      paper,
      background: Number.isFinite(background)
        ? Math.max(0, Math.min(255, Math.round(background)))
        : 0,
    },
    codec,
  );
}

/* -------------------------------------------------------------------------
 * A screenshot, pasted
 * ---------------------------------------------------------------------- */

/**
 * The clipboard payload this reads: the item list of a `paste` event.
 *
 * A structural type rather than `DataTransfer` so a test can hand it a plain
 * object — Node has no `DataTransfer` — and so the host can pass the event's
 * `clipboardData` without a cast.
 */
export interface ClipboardPayloadLike {
  readonly items: ArrayLike<{
    readonly kind: string;
    readonly type: string;
    getAsFile(): File | null;
  }>;
}

/**
 * The first image a clipboard payload carries, or `null`.
 *
 * A screenshot arrives as an item whose `kind` is `"file"` and whose type is an
 * image MIME — `image/png` from the Windows snipping tool and from Chromium's
 * own copy, `image/jpeg` from a phone — and `getAsFile()` is what turns it into
 * something the page raster can read. Text pasted into the note editor has no
 * such item, which is how the two pastes stay apart.
 */
export function imageFileFromClipboard(
  data: ClipboardPayloadLike | null | undefined,
): File | null {
  const items = data?.items;
  if (!items) return null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "file") continue;
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}
