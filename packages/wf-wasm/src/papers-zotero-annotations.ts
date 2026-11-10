/**
 * Zotero annotation and note rows (Rust `papers::zotero_annotations`). Re-exported
 * from index.ts. The types are generated from Rust into bindings.ts.
 */
import {
  zoteroItemKey as rawItemKey,
  zoteroNoteFromItem as rawNoteFromItem,
  zoteroPickMainPdf as rawPickMainPdf,
} from "../pkg/wf_wasm.js";
import type {
  ZoteroAnnotation,
  ZoteroItemRow,
} from "./bindings.js";

export {
  zoteroAnnotationFromItem,
  zoteroIsPdfAttachment,
} from "../pkg/wf_wasm.js";

export type {
  ZoteroAnnotation,
  ZoteroAnnotationKind,
  ZoteroAnnotationPosition,
  ZoteroItemData,
  ZoteroItemRow,
  ZoteroTagRow,
} from "./bindings.js";

/** The item's key from the top level or `data`, or undefined. */
export function zoteroItemKey(item: ZoteroItemRow): string | undefined {
  return rawItemKey(item) ?? undefined;
}

/** The paper's main PDF key among its PDF attachments, or undefined. */
export function zoteroPickMainPdf(pdfs: readonly ZoteroItemRow[]): string | undefined {
  return rawPickMainPdf(pdfs) ?? undefined;
}

/** A note row as the app caches it, or undefined when its text is empty. */
export function zoteroNoteFromItem(item: ZoteroItemRow): ZoteroAnnotation | undefined {
  return rawNoteFromItem(item) ?? undefined;
}
