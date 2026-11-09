/**
 * Zotero item <-> paper mapping (Rust `papers::zotero_mapping`). Re-exported from index.ts.
 * The types are generated from Rust into bindings.ts.
 */
import {
  zoteroArxivId as rawZoteroArxivId,
  zoteroContentKeys as rawZoteroContentKeys,
  zoteroRemoteToInput as rawZoteroRemoteToInput,
  zoteroRemoteToMetadata as rawZoteroRemoteToMetadata,
  toZoteroItem as rawToZoteroItem,
} from "../pkg/wf_wasm.js";
import type {
  MergePaper,
  ZoteroExportItem,
  ZoteroItem,
  ZoteroPaperInput,
} from "./bindings.js";

export type {
  ZoteroCreator,
  ZoteroExportCreator,
  ZoteroExportItem,
  ZoteroItem,
  ZoteroPaperInput,
} from "./bindings.js";

/** The arXiv id of a Zotero item (from its `extra` tag, its URL, or an arxiv.org link), or null. */
export function zoteroArxivId(item: ZoteroItem): string | null {
  return rawZoteroArxivId(item) as string | null;
}

/** The keys a paper matches on across DOI, arXiv id and normalised title. */
export function zoteroContentKeys(
  doi?: string | null,
  arxivId?: string | null,
  title?: string | null,
): string[] {
  return rawZoteroContentKeys(doi, arxivId, title) as string[];
}

/** A paper read from a Zotero item, with its key kept under `metadata.zoteroKey`. */
export function zoteroRemoteToInput(item: ZoteroItem): ZoteroPaperInput {
  return rawZoteroRemoteToInput(item) as ZoteroPaperInput;
}

/** The metadata a metadata lookup returns for a Zotero item. */
export function zoteroRemoteToMetadata(item: ZoteroItem): ZoteroPaperInput {
  return rawZoteroRemoteToMetadata(item) as ZoteroPaperInput;
}

/** The `journalArticle` written to Zotero for a paper. */
export function toZoteroItem(paper: MergePaper): ZoteroExportItem {
  return rawToZoteroItem(paper) as ZoteroExportItem;
}
