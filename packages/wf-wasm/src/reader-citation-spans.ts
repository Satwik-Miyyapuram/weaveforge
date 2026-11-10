/**
 * Citation underline planning (Rust `reader_citation_spans`), re-exported from index.ts. Keeps the
 * signatures of apps/web/src/features/reader/application/citation-spans.ts. DOM decoration stays in TS.
 */
export type { CitationItemRange } from "./bindings.js";

export {
  mentionItemRanges,
  planCitationSegments,
} from "../pkg/wf_wasm.js";

/** The part of a mention the planner needs. (Narrowing: `kind` is a TS literal union; Rust field is Option<String>.) */
export interface CiteSpan {
  key: string;
  start: number;
  end: number;
  text?: string;
  label?: string;
  kind?: "citation" | "figure" | "url";
  url?: string;
}

/** One piece of a run, split at mention boundaries. (Narrowing: uses the TS CiteSpan above.) */
export interface TextSegment {
  from: number;
  to: number;
  text: string;
  mention?: CiteSpan;
}

/** The page text item shape the planner reads: `str` and `hasEOL`. (Narrowing: Rust takes full SelectionPageTextItem.) */
export interface CitationPageTextItem {
  str: string;
  hasEOL?: boolean;
}
