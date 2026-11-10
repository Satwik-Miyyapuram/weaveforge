/**
 * Zotero item <-> paper mapping (Rust `papers::zotero_mapping`). Re-exported from index.ts.
 * The types are generated from Rust into bindings.ts.
 */
import {
  zoteroContentKeys as rawZoteroContentKeys,
} from "../pkg/wf_wasm.js";
import type {
  ZoteroExportItem,
  ZoteroItem,
  ZoteroPaperInput,
} from "./bindings.js";

export {
  toZoteroItem,
  zoteroArxivId,
  zoteroRemoteToInput,
  zoteroRemoteToMetadata,
} from "../pkg/wf_wasm.js";

export type {
  ZoteroCreator,
  ZoteroExportCreator,
  ZoteroExportItem,
  ZoteroItem,
  ZoteroPaperInput,
} from "./bindings.js";

/** The keys a paper matches on across DOI, arXiv id and normalised title. */
export function zoteroContentKeys(
  doi?: string | null,
  arxivId?: string | null,
  title?: string | null,
): string[] {
  return rawZoteroContentKeys(doi, arxivId, title) as string[];
}

