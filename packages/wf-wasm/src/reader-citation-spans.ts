/**
 * Citation underline planning (Rust `reader_citation_spans`), re-exported from index.ts. Keeps the
 * signatures of apps/web/src/features/reader/application/citation-spans.ts. DOM decoration stays in TS.
 */
import { mentionItemRanges as rawMentionItemRanges, planCitationSegments as rawPlanCitationSegments } from "../pkg/wf_wasm.js";
import type { CitationItemRange } from "./bindings.js";

export type { CitationItemRange } from "./bindings.js";

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

/** Map a mention's page offsets onto the runs it covers. */
export function mentionItemRanges(
  items: readonly CitationPageTextItem[],
  start: number,
  end: number,
): CitationItemRange[] {
  return rawMentionItemRanges(items, start, end) as CitationItemRange[];
}

/** Split each run at every mention boundary that falls inside it. */
export function planCitationSegments(
  items: readonly CitationPageTextItem[],
  mentions: readonly CiteSpan[],
): TextSegment[][] {
  return rawPlanCitationSegments(items, mentions) as TextSegment[][];
}
