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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface WikiLintFns {
  /**
 * `otherTitles` are notes and papers that exist outside the wiki. A link to
 * one is not dead; it is just not a wiki page (E39).
 */
  lintWiki(pages: readonly WikiPageRef[], otherTitles?: readonly string[]): LintReport;
  /**
 * Order fixes so earlier steps do not invalidate later ones.
 *
 * Merging duplicates first is not cosmetic: it removes pages, which resolves
 * some dead links and creates others. Running dead-link repair first would fix
 * links into a page that is about to disappear.
 */
  planFixOrder(report: LintReport): FixStep[];
}
