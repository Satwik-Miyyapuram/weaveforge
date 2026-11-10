/**
 * Project cached Zotero annotations into the single ReaderAnnotation model.
 * Notes (kind === "note") are excluded — they are not page-anchored.
 * The projection itself lives in Rust (`reader::zotero_projection`).
 */

import type { ReaderAnnotation } from "@weaveforge/core";
import type { ZoteroAnnotation } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

export function projectZoteroAnnotations(
  annotations: readonly ZoteroAnnotation[],
  options?: { contentHash?: string; now?: string },
): ReaderAnnotation[] {
  return readyCore().projectZoteroAnnotations(annotations, options) as ReaderAnnotation[];
}
