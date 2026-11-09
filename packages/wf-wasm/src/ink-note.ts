/**
 * Ink note body wrappers, re-exported from index.ts. Inputs over
 * MAX_INDEX_TEXT_UTF16 throw before they reach Rust, as in index.ts.
 */
import {
  maxIndexTextUtf16 as rawMaxIndexTextUtf16,
  isInkChunkId as rawIsInkChunkId,
  isInkNoteBody as rawIsInkNoteBody,
  readInkNoteBody as rawReadInkNoteBody,
  readableText as rawReadableText,
  writeInkNoteBody as rawWriteInkNoteBody,
  defaultInkNoteMeta as rawDefaultInkNoteMeta,
  readInkNoteMeta as rawReadInkNoteMeta,
  splitInkTextLayer as rawSplitInkTextLayer,
} from "../pkg/wf_wasm.js";
import type { InkNoteMeta } from "./bindings.js";

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

/** The header of a new, empty ink note (Rust `default_ink_note_meta`). */
export function defaultInkNoteMeta(): InkNoteMeta {
  return rawDefaultInkNoteMeta() as InkNoteMeta;
}

/** The ink note header read from frontmatter, with defaults for missing keys. */
export function readInkNoteMeta(frontmatter: Readonly<Record<string, unknown>>): InkNoteMeta {
  return rawReadInkNoteMeta(frontmatter) as InkNoteMeta;
}

/** The recognised text of each page, split at the page markers. */
export function splitInkTextLayer(body: string): string[] {
  return rawSplitInkTextLayer(body) as string[];
}