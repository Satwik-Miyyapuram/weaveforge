/**
 * Metadata-source response mapping (Rust `papers::metadata_mapping`). Re-exported from index.ts.
 * The types are generated from Rust into bindings.ts.
 */
import {
  arxivEntryToMetadata as rawArxivEntryToMetadata,
  crossrefToMetadata as rawCrossrefToMetadata,
  openAlexToMetadata as rawOpenAlexToMetadata,
  semanticScholarToMetadata as rawSemanticScholarToMetadata,
  urlMetaToMetadata as rawUrlMetaToMetadata,
} from "../pkg/wf_wasm.js";
import type {
  CrossrefMessage,
  OpenAlexWork,
  SemanticScholarPaper,
  UrlMetaResponse,
  ZoteroPaperInput,
} from "./bindings.js";

export type {
  CrossrefMessage,
  OpenAlexWork,
  SemanticScholarPaper,
  UrlMetaResponse,
} from "./bindings.js";

/** A Crossref `message` as a paper; `doi` is the DOI asked for, used when Crossref names none. */
export function crossrefToMetadata(message: CrossrefMessage, doi: string): ZoteroPaperInput {
  return rawCrossrefToMetadata(message, doi) as ZoteroPaperInput;
}

/** A Semantic Scholar paper as a paper, with its open-access PDF and citation count under `metadata`. */
export function semanticScholarToMetadata(paper: SemanticScholarPaper): ZoteroPaperInput {
  return rawSemanticScholarToMetadata(paper) as ZoteroPaperInput;
}

/** An OpenAlex work as a paper. */
export function openAlexToMetadata(work: OpenAlexWork): ZoteroPaperInput {
  return rawOpenAlexToMetadata(work) as ZoteroPaperInput;
}

/** The first entry of an arXiv Atom feed as a paper. Throws `arXiv has no paper <id>` on a miss. */
export function arxivEntryToMetadata(xml: string, arxivId: string): ZoteroPaperInput {
  return rawArxivEntryToMetadata(xml, arxivId) as ZoteroPaperInput;
}

/** A page's own metadata as a paper. Throws when the page has no usable title. */
export function urlMetaToMetadata(meta: UrlMetaResponse): ZoteroPaperInput {
  return rawUrlMetaToMetadata(meta) as ZoteroPaperInput;
}
