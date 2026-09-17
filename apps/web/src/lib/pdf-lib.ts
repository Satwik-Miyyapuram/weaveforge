/**
 * Loading pdf.js.
 *
 * Two features want it — the reader, and the ink editor's PDF page backgrounds
 * — and each must not reach into the other for it, so it lives in `lib` rather
 * than under either one (CONTRIBUTING § SOLID boundaries). The loader itself is
 * shared state on purpose: the bundle is a megabyte, and whichever feature asks
 * first is the one that pays for it.
 */

export type PdfLib = typeof import("pdfjs-dist");

/** The pdf.js bundle is a megabyte; it is fetched once, on the first open. */
let pdfLibPromise: Promise<PdfLib> | null = null;

export async function loadPdfLib(): Promise<PdfLib> {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfLibPromise;
}
