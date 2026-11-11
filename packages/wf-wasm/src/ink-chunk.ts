/**
 * The ink chunk container (Rust `ink::chunk`), re-exported from index.ts:
 * layout, header, body checks and the body encoder. Core's ink-binary.ts keeps
 * the typed-array views and the async compression around these, and turns the
 * thrown errors into `InkChunkError`.
 */
export {
  absolutePointTriples,
  checkInkChunkBody,
  encodeInkChunkBody,
  fitsInkNoteBudget,
  inkChunkBodySize,
  inkChunkHeaderBytes,
  inkChunkRawThreshold,
  inkChunkShouldTryCompress,
  inkChunkStoresCompressed,
  pageFromChunkBody,
  readInkChunkHeader,
  strokePointTriples,
} from "../pkg/wf_wasm.js";

