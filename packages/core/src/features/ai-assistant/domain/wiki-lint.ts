/** Types for wiki-lint. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

export interface WikiPageRef {
  id: string;
  title: string;
  body: string;
  aliases?: readonly string[];
}

export type LintKind =
  | "duplicate"
  | "near-duplicate"
  | "dead-link"
  | "orphan"
  | "empty";

export type LintSeverity = "error" | "warning" | "info";

export interface LintFinding {
  kind: LintKind;
  severity: LintSeverity;
  pageId: string;
  message: string;
  /** The other page involved, for duplicates. */
  relatedPageId?: string;
  /** The unresolved target, for dead links. */
  target?: string;
}

export interface LintReport {
  findings: LintFinding[];
  counts: Record<LintKind, number>;
}

/** A page with nothing but frontmatter and headings has no content of its own. */
const MIN_CONTENT_CHARS = 40;

/** Above this, two titles are the same idea spelled differently. */
export const NEAR_DUPLICATE_THRESHOLD = 0.75;

export interface FixStep {
  kind: LintKind;
  description: string;
  findings: LintFinding[];
}

