import { loadPdfLib } from "@/lib/pdf-lib";

/**
 * Stand-in for Overleaf's `@/features/pdf-preview/util/pdf-js`: opens a PDF
 * with the app's shared pdf.js loader. Returns the same `{ promise }` shape as
 * pdf.js's loading task, which is all the graphics widget reads.
 */
export function loadPdfDocumentFromUrl(url: string) {
  return { promise: loadPdfLib().then((lib) => lib.getDocument(url).promise) };
}
