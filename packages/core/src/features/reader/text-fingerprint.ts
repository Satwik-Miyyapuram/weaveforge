/**
 * A stable key for a document's text layer: sixteen hex characters from two
 * FNV-1a passes over the pages. Two copies of the same paper — the arXiv PDF
 * and the publisher's — hash the same when their text layers agree, so a
 * reference lookup done for one serves the other, and a re-upload of the same
 * file never re-resolves. Synchronous, so it can run where SubtleCrypto cannot.
 */
export function textFingerprint(texts: readonly string[]): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (const text of texts) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ ((c * 31 + i) & 0xffff), 0x01000193) >>> 0;
    }
    a = Math.imul(a ^ 0x0a, 0x01000193) >>> 0;
    b = Math.imul(b ^ 0x0a, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
