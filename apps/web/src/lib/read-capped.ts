/**
 * Read a body up to `maxBytes`, or `null` past it.
 *
 * The one copy every proxy and `safeFetch` use. The cap holds while reading:
 * a `content-length` can be absent, wrong, or the encoded size of a body the
 * runtime decompresses. Past the cap the stream is cancelled, so the
 * connection stops pulling bytes nobody will read.
 *
 * One buffer, doubled as needed (capped at the limit): a large body costs a
 * few copies, never a second buffer of the whole size at the end. No body is
 * an empty body.
 */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = body?.getReader();
  if (!reader) return new Uint8Array();

  let buffer = new Uint8Array(Math.min(64 * 1024, maxBytes));
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    if (total + value.byteLength > buffer.byteLength) {
      const grown = new Uint8Array(Math.min(maxBytes, Math.max(buffer.byteLength * 2, total + value.byteLength)));
      grown.set(buffer.subarray(0, total));
      buffer = grown;
    }
    buffer.set(value, total);
    total += value.byteLength;
  }
  return buffer.subarray(0, total);
}
