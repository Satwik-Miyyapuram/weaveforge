/**
 * What a PDF proxy takes for a PDF: the hosted route (`api/pdf-proxy/_proxy.ts`)
 * and the desktop shell's (`apps/desktop/src/pdf-proxy.ts`) share these, so
 * the two cannot disagree about a landing page labelled as a PDF.
 */

/** How far into the body `%PDF` may sit; some servers send a preamble. */
export const PDF_MAGIC_WINDOW = 1024;

/** A PDF, or an unlabelled binary that the magic check then decides. */
export function isPdfContentType(value: string | null): boolean {
  if (!value) return false;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/pdf" || type === "application/octet-stream";
}

/** True when `%PDF` appears within the first `PDF_MAGIC_WINDOW` bytes. */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  const window = bytes.subarray(0, Math.min(PDF_MAGIC_WINDOW, bytes.byteLength));
  return new TextDecoder("latin1").decode(window).includes("%PDF");
}
