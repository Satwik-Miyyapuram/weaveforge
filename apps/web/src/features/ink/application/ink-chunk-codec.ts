/**
 * The codec a chunk is read and written with, on both sides of the worker.
 *
 * `deflate-raw` through `CompressionStream`, which every Chromium and Firefox
 * has and Safari 16.4+ does; brotli is **not** reachable from the web at all
 * (`CompressionStream` does not expose it, §4.3), which is why the desktop
 * build passes its own. `identity` — what a `null` here becomes — is for a
 * page small enough to have been stored raw.
 *
 * It is one module rather than two copies because the worker is no longer the
 * only writer: the host writes a page's chunk itself when the page's
 * background changes (§4.8), and a chunk written with one codec has to be
 * readable by the other. Absent `CompressionStream` this falls back to
 * identity, which decodes an uncompressed chunk correctly and refuses a
 * compressed one with the container's own error rather than silently
 * producing nothing.
 */

import type { InkChunkCodec } from "@weaveforge/core";

/** The codec the app stores its chunks with, by name. */
export const INK_CHUNK_CODEC_NAME = "deflate-raw" as const;

/** A codec by name, or `null` where this runtime cannot provide it. */
export function inkChunkCodec(
  name: "identity" | "deflate-raw" | undefined,
): InkChunkCodec | null {
  if (name !== "deflate-raw") return null;
  if (
    typeof CompressionStream !== "function" ||
    typeof DecompressionStream !== "function"
  )
    return null;
  return {
    id: "deflate-raw",
    compress: async (bytes) =>
      pipeThrough(new CompressionStream("deflate-raw"), bytes),
    decompress: async (bytes) =>
      pipeThrough(new DecompressionStream("deflate-raw"), bytes),
  };
}

/**
 * The codec this runtime can store with, or `undefined` to leave core on
 * identity — which is what every core call's parameter default means.
 */
export function availableInkChunkCodec(): InkChunkCodec | undefined {
  return inkChunkCodec(INK_CHUNK_CODEC_NAME) ?? undefined;
}

/** Push bytes through a transform stream and collect what comes out. */
export async function pipeThrough(
  stream: GenericTransformStream,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value as Uint8Array);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
