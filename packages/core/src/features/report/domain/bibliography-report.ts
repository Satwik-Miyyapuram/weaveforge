/** Types for bibliography-report. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { BibParseResult } from "./bib-entries.js";
import type { LatexSourceFile } from "./latex-section-tree.js";

export type BibFindingKind =
  | "cited-not-defined"
  | "defined-not-cited"
  | "duplicate-key"
  | "missing-field"
  | "malformed-doi"
  | "malformed-url"
  | "author-format"
  | "missing-bib-file"
  | "parse-warning";

export interface BibFinding {
  kind: BibFindingKind;
  /** An error breaks the document or the bibliography; a warning is untidy. */
  severity: "error" | "warning";
  file: string;
  /** 1-based. */
  line: number;
  message: string;
  /** The cite key the finding is about, when it is about one. */
  key?: string;
}

export interface BibliographyInput {
  /** Every text file of the project — `.tex` and `.bib` alike. */
  sources: readonly LatexSourceFile[];
  bibliography: BibParseResult;
}

export interface BibliographyReport {
  findings: BibFinding[];
  /** Distinct keys cited anywhere in the document. */
  citedKeys: string[];
  entryCount: number;
  /** True when `\nocite{*}` makes every entry cited by definition. */
  citesEverything: boolean;
}

interface Citation {
  key: string;
  file: string;
  line: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface BibliographyReportFns {
  /**
 * Check one project's citations against its bibliography.
 *
 * Pure: give it the files and the parsed entries, and it answers the same way
 * every time.
 */
  checkBibliography(input: BibliographyInput): BibliographyReport;
}
