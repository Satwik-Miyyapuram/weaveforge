/** Types for bib-entries. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

export interface BibEntry {
  /** Lower-cased entry type: `article`, `inproceedings`, `misc`. */
  type: string;
  key: string;
  /** Field names lower-cased; values are the literal text, braces stripped. */
  fields: Record<string, string>;
  file: string;
  /** 1-based line of the `@`. */
  line: number;
}

export interface BibWarning {
  file: string;
  line: number;
  message: string;
}

export interface BibParseResult {
  entries: BibEntry[];
  warnings: BibWarning[];
}

