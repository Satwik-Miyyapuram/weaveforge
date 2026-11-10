/**
 * Ink note body wrappers, re-exported from index.ts. Inputs over
 * MAX_INDEX_TEXT_UTF16 throw in Rust before they are copied in.
 */
import {
  inkChunkIdOfFileName as rawInkChunkIdOfFileName,
  readInkNoteBody as rawReadInkNoteBody,
} from "../pkg/wf_wasm.js";
import type {
  InkNoteMeta,
} from "./bindings.js";

export {
  isInkChunkId,
  isInkNoteBody,
  readableText,
  writeInkNoteBody,
} from "../pkg/wf_wasm.js";

export {
  defaultInkNoteMeta,
  readInkNoteMeta,
  splitInkTextLayer,
} from "../pkg/wf_wasm.js";

/** The chunk id a filename names (`<id>.inkb`), or `null` for any other name (Rust `chunk_id_of_file_name`). */
export function inkChunkIdOfFileName(name: string): string | null {
  return rawInkChunkIdOfFileName(name) ?? null;
}

/** The header and text of an ink note body (Rust `read_ink_note_body`). */
export function readInkNoteBody(body: string): { meta: InkNoteMeta; text: string } {
  return rawReadInkNoteBody(body) as { meta: InkNoteMeta; text: string };
}

