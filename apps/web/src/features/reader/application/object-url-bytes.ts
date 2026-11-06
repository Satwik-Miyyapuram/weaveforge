/**
 * PDF bytes behind object URLs this page made, kept in memory.
 *
 * The desktop app's origin cannot fetch a `blob:` URL (status 0), so pdf.js
 * cannot read one either. A viewer that makes a PDF object URL registers its
 * blob here, and the reader hands pdf.js the bytes instead of the URL.
 */
const blobs = new Map<string, Blob>();

/** Makes an object URL for `blob` and remembers the blob until `revokePdfObjectUrl`. */
export function createPdfObjectUrl(blob: Blob, create: (blob: Blob) => string = (b) => URL.createObjectURL(b)): string {
  const url = create(blob);
  blobs.set(url, blob);
  return url;
}

export function revokePdfObjectUrl(url: string, revoke: (url: string) => void = (u) => URL.revokeObjectURL(u)): void {
  blobs.delete(url);
  revoke(url);
}

/** The bytes behind a registered object URL, or null if it was not made here. */
export async function pdfObjectUrlBytes(url: string): Promise<Uint8Array | null> {
  const blob = blobs.get(url);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
