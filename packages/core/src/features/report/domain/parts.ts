import { ValidationError } from "../../../shared/errors.js";
import type {
  Identifiable,
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/parts.js";

// --- report-section ---
/** Types for report-section. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/** A section's writing status, in workflow order. */
export const REPORT_STATUSES = ["not_started", "drafting", "review", "done"] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportSection extends Identifiable {
  id: string;
  title: string;
  /** Outline number, e.g. "3.2". */
  sectionNo?: string;
  /** Parent section id for nesting (chapter > section); null/undefined = top. */
  parentId?: string;
  status: ReportStatus;
  wordCount: number;
  targetWords?: number;
  /** ISO date (yyyy-mm-dd). */
  deadline?: string;
  /** Overleaf / Google Doc / repo path. */
  draftUrl?: string;
  notes?: string;
  sortOrder: number;
  createdAt: string;
  /** When the section last changed; set by the database, absent until first read back. */
  updatedAt?: string;
}

export interface NewReportSectionInput {
  title: string;
  sectionNo?: string;
  parentId?: string;
  status?: ReportStatus;
  wordCount?: number;
  targetWords?: number;
  deadline?: string;
  draftUrl?: string;
  notes?: string;
  sortOrder?: number;
}

export interface ReportSectionFilter {
  status?: ReportStatus;
  /** Use `null` to select only top-level sections. */
  parentId?: string | null;
  /** Case-insensitive substring match against title. */
  titleContains?: string;
}

/** A section with its descendants resolved (for rendering the outline tree). */
export interface ReportSectionTreeNode {
  section: ReportSection;
  children: ReportSectionTreeNode[];
}

export class ReportSectionValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ReportSectionValidationError";
  }
}

// --- parts ---
// --- bib-entries ---
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

// --- latex-section-tree ---
// The parser runs in Rust (wf-core `latex_section_tree`); these are its JS-facing types.

export interface LatexSourceFile {
  path: string;
  content: string;
}

export interface LatexSectionNode {
  id: string;
  title: string;
  command: string;
  level: number;
  file: string;
  startLine: number;
  endLine: number;
  preview: string;
  children: LatexSectionNode[];
}

export interface LatexSectionTreeResult {
  roots: LatexSectionNode[];
  files: string[];
  warnings: string[];
}

// --- bibliography-report ---
/** Types for bibliography-report. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
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

// --- cite-key ---
/** Types for cite-key. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export type CitationFormat = "latex" | "pandoc" | "footnote" | "raw";

// --- markdown-to-latex ---
/** Types for markdown-to-latex. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export interface MarkdownToLatexImageRef {
  /** Storage path after `reportimg:`. */
  path: string;
  /** Relative path used in `\includegraphics{...}` (under `figures/`). */
  fileName: string;
}

export interface MarkdownToLatexOptions {
  /**
   * Map of `normalizeTitleKey(paper.title)` → biblatex cite key.
   * When set, matching `[[wikilinks]]` become `\cite{key}`.
   */
  citeByTitle?: ReadonlyMap<string, string>;
}

export interface MarkdownToLatexResult {
  latex: string;
  warnings: string[];
  images: MarkdownToLatexImageRef[];
  /** Bib keys emitted via `\cite{...}` (unique, insertion order). */
  citedKeys: string[];
}

// --- prisma-figure ---
/** Types for prisma-figure. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export interface PrismaFigureOptions {
  /** `\label{...}`, so the prose can `\ref` it. */
  label?: string;
  caption?: string;
  /** Exclusion reasons, as `exclusionReasons` returns them. */
  reasons?: readonly { reason: string; count: number }[];
  /** The database or register the records came from, if it is worth naming. */
  source?: string;
}

/** The packages the figure needs, for a preamble that does not have them yet. */
export const PRISMA_FIGURE_PACKAGES: readonly string[] = ["tikz", "float"];

// --- report-section-repository ---
/**
 * Repository contract for report sections.
 *
 * Defined in the domain layer (Dependency Inversion). Adds `getTree()` for the
 * hierarchical outline on top of the generic read/write contract. Every
 * implementation must pass the shared contract test suite (Liskov).
 */
export interface IReportSectionRepository
  extends IReadableRepository<ReportSection, ReportSectionFilter>,
    IWritableRepository<ReportSection> {
  /** Return all sections assembled into the nested outline tree. */
  getTree(): Promise<ReportSectionTreeNode[]>;
}

/** Report-section writes that validate and apply changes (the Rust `report_sections` arms). */
export interface IReportSectionManager {
  add(input: NewReportSectionInput): Promise<ReportSection>;
  setTitle(id: string, title: string): Promise<ReportSection>;
  setParent(id: string, parentId: string | null): Promise<ReportSection>;
  setStatus(id: string, status: ReportStatus): Promise<ReportSection>;
  setProgress(id: string, wordCount: number): Promise<ReportSection>;
  setNotes(id: string, notes: string): Promise<ReportSection>;
  remove(id: string): Promise<void>;
}
