/**
 * Ink note body wrappers, re-exported from index.ts. Inputs over
 * MAX_INDEX_TEXT_UTF16 throw in Rust before they are copied in.
 */
export {
  isInkChunkId,
  isInkNoteBody,
  readableText,
  writeInkNoteBody,
} from "../pkg/wf_wasm.js";

export {
  defaultInkNoteMeta,
  inkChunkIdOfFileName,
  readInkNoteBody,
  readInkNoteMeta,
  splitInkTextLayer,
} from "../pkg/wf_wasm.js";

