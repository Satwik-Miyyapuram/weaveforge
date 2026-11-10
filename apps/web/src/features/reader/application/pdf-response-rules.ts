/**
 * What a PDF proxy takes for a PDF: the hosted route (`api/pdf-proxy/_proxy.ts`)
 * and the desktop shell's (`apps/desktop/src/pdf-proxy.ts`) share these, so
 * the two cannot disagree about a landing page labelled as a PDF.
 *
 * The checks themselves (`isPdfContentType`, `hasPdfMagic`) are in the Rust
 * core; only the shared window constant stays here.
 */

/** How far into the body `%PDF` may sit; some servers send a preamble. */
export const PDF_MAGIC_WINDOW = 1024;
