/**
 * PDFium (WASM) page rasteriser behind the `wf:pdfEngine` flag (0.9.8, 6b).
 * pdf.js still loads every document for text, links, find and annotations;
 * only the page bitmap comes from PDFium, drawn with putImageData so the page
 * canvas stays a plain CPU bitmap (spike, 11 pages: GPU 193 -> 71 MB).
 */
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";

export type PdfEngine = "pdfium" | "pdfjs";

/** Dev A/B flag. Anything but "pdfium", or no storage, keeps pdf.js. */
export function readPdfEngine(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): PdfEngine {
  try {
    return storage?.getItem("wf:pdfEngine") === "pdfium" ? "pdfium" : "pdfjs";
  } catch {
    return "pdfjs";
  }
}

/** Degrees -> PDFium quarter turns (0..3). PDFium adds the page's own /Rotate. */
export function pdfiumRotate(degrees: number): number {
  return ((Math.round(degrees / 90) % 4) + 4) % 4;
}

const FPDF_ANNOT = 0x01;
/** PDFium writes BGRA; this flag makes it RGBA, which ImageData wants. */
const FPDF_REVERSE_BYTE_ORDER = 0x10;

let modulePromise: Promise<WrappedPdfiumModule> | null = null;

/** The 4.6 MB WASM is fetched once, on the first flagged open. */
export function loadPdfium(
  loadWasm: () => Promise<ArrayBuffer> = () => fetch("/pdfium.wasm").then((r) => r.arrayBuffer()),
  importLib: () => Promise<typeof import("@embedpdf/pdfium")> = () => import("@embedpdf/pdfium"),
): Promise<WrappedPdfiumModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const [{ init }, wasmBinary] = await Promise.all([importLib(), loadWasm()]);
      const m = await init({ wasmBinary });
      m.PDFiumExt_Init();
      return m;
    })();
    // A failed load is retried on the next open, not kept until a reload.
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}

export interface PdfiumDocument {
  /** RGBA pixels of one page at `width` x `height` device pixels, on white. */
  renderPage(pageIndex: number, width: number, height: number, degrees: number): Uint8ClampedArray<ArrayBuffer>;
  close(): void;
}

function heap(m: WrappedPdfiumModule): Uint8Array {
  const pdfium = m.pdfium as unknown as { HEAPU8?: Uint8Array; wasmExports: { memory: WebAssembly.Memory } };
  return pdfium.HEAPU8 ?? new Uint8Array(pdfium.wasmExports.memory.buffer);
}

/** Null when PDFium cannot parse the bytes. */
export function openPdfiumDocument(m: WrappedPdfiumModule, bytes: Uint8Array): PdfiumDocument | null {
  const ptr = m.pdfium.wasmExports.malloc(bytes.length);
  heap(m).set(bytes, ptr);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, "");
  if (!doc) {
    m.pdfium.wasmExports.free(ptr);
    return null;
  }
  let open = true;
  return {
    renderPage(pageIndex, width, height, degrees) {
      if (!open) throw new Error("PDFium document is closed");
      const page = m.FPDF_LoadPage(doc, pageIndex);
      if (!page) throw new Error(`PDFium could not load page ${pageIndex + 1}`);
      const bitmap = m.FPDFBitmap_Create(width, height, 1);
      try {
        m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        m.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, pdfiumRotate(degrees), FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER);
        const buffer = m.FPDFBitmap_GetBuffer(bitmap);
        return new Uint8ClampedArray(heap(m).buffer, buffer, width * height * 4).slice();
      } finally {
        m.FPDFBitmap_Destroy(bitmap);
        m.FPDF_ClosePage(page);
      }
    },
    close() {
      if (!open) return;
      open = false;
      m.FPDF_CloseDocument(doc);
      m.pdfium.wasmExports.free(ptr);
    },
  };
}

/** Paints one page into `ctx` at device pixels; putImageData ignores the transform. */
export function paintPdfiumPage(
  doc: PdfiumDocument,
  ctx: CanvasRenderingContext2D,
  pageIndex: number,
  width: number,
  height: number,
  degrees: number,
): void {
  ctx.putImageData(new ImageData(doc.renderPage(pageIndex, width, height, degrees), width, height), 0, 0);
}
