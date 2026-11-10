/**
 * The ink chunk container (Rust `ink::chunk`), re-exported from index.ts:
 * layout, header, body checks and the body encoder. Core's ink-binary.ts keeps
 * the typed-array views and the async compression around these, and turns the
 * thrown errors into `InkChunkError`.
 */
import {
  fitsInkNoteBudget as rawFitsInkNoteBudget,
} from "../pkg/wf_wasm.js";

export {
  absolutePointTriples,
  checkInkChunkBody,
  encodeInkChunkBody,
  inkChunkBodySize,
  inkChunkHeaderBytes,
  inkChunkRawThreshold,
  inkChunkShouldTryCompress,
  inkChunkStoresCompressed,
  pageFromChunkBody,
  readInkChunkHeader,
  strokePointTriples,
} from "../pkg/wf_wasm.js";

/** Whether chunks of these on-disk sizes still fit a note's budget. */
export function fitsInkNoteBudget(sizes: readonly number[]): boolean {
  return rawFitsInkNoteBudget(Float64Array.from(sizes));
}

