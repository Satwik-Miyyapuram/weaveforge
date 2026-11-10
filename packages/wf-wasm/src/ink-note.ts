/**
 * Ink note body wrappers, re-exported from index.ts. Inputs over
 * MAX_INDEX_TEXT_UTF16 throw before they reach Rust, as in index.ts.
 */
import {
  maxIndexTextUtf16 as rawMaxIndexTextUtf16,
  isInkChunkId as rawIsInkChunkId,
  inkChunkIdOfFileName as rawInkChunkIdOfFileName,
  isInkNoteBody as rawIsInkNoteBody,
  readInkNoteBody as rawReadInkNoteBody,
  readableText as rawReadableText,
  writeInkNoteBody as rawWriteInkNoteBody,
} from "../pkg/wf_wasm.js";
import type {
  InkNoteMeta,
} from "./bindings.js";

export {
  defaultInkNoteMeta,
  readInkNoteMeta,
  splitInkTextLayer,
} from "../pkg/wf_wasm.js";

function checkIndexText(text: string): void {
  const max = rawMaxIndexTextUtf16();
  if (text.length > max) {
    throw new RangeError(`text is ${text.length} UTF-16 units; MAX_INDEX_TEXT_UTF16 is ${max}`);
  }
}

/** Whether `text` is an ink chunk id (Rust `is_ink_chunk_id`). */
export function isInkChunkId(text: string): boolean {
  checkIndexText(text);
  return rawIsInkChunkId(text);
}

/** The chunk id a filename names (`<id>.inkb`), or `null` for any other name (Rust `chunk_id_of_file_name`). */
export function inkChunkIdOfFileName(name: string): string | null {
  return rawInkChunkIdOfFileName(name) ?? null;
}

/** Whether `body` is an ink note body (Rust `is_ink_note_body`). */
export function isInkNoteBody(body: string): boolean {
  checkIndexText(body);
  return rawIsInkNoteBody(body);
}

/** The header and text of an ink note body (Rust `read_ink_note_body`). */
export function readInkNoteBody(body: string): { meta: InkNoteMeta; text: string } {
  checkIndexText(body);
  return rawReadInkNoteBody(body) as { meta: InkNoteMeta; text: string };
}

/** A stored body's readable words: plain text as is, ink pages joined by blank lines (Rust `readable_text`). */
export function readableText(body: string): string {
  checkIndexText(body);
  return rawReadableText(body);
}

/** An ink note body: the header for `meta`, then `text` (Rust `write_ink_note_body`). */
export function writeInkNoteBody(
  meta: Omit<InkNoteMeta, "pageOrder"> & { readonly pageOrder: readonly string[] },
  text: string,
): string {
  checkIndexText(text);
  return rawWriteInkNoteBody(meta, text);
}

