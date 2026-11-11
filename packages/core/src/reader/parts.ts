import { rust } from "../shared/rust.js";
import type { IPdfSourceResolver, PdfSourceHit, PdfSourcePaper } from "./pdf-source-ladder.js";
import type {
  AnnotationSyncState,
  ReaderAnnotation,
  ReaderAnnotationType,
} from "./reader-annotation.js";

// --- anchor-shapes ---
/**
 * Structural copies of the anchor shapes core still reads. Core cannot import
 * `@weaveforge/wasm`, so these mirror `packages/wf-wasm/src/wrappers-9.ts`; the Rust
 * core (crates/wf-core) is the authority. The TS anchor logic is gone.
 */
/** Primary anchor: quote + optional context (W3C TextQuoteSelector). */
export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** Fallback anchor: character offsets into extracted text (W3C TextPositionSelector). */
export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

/** A stored locus for jump-to-source. */
export interface PdfLocus {
  quote: TextQuoteSelector;
  position?: TextPositionSelector;
}

/** Character span in extracted text, UTF-16 offsets. */
export interface TextSpan {
  start: number;
  end: number;
}

export type AnchorConfidence = "high" | "low";

export interface ResolvedAnchor extends TextSpan {
  via: "quote" | "position";
  confidence: AnchorConfidence;
}

/** Zotero `annotationPosition` shape. */
export interface ZoteroRectPosition {
  pageIndex: number;
  rects?: number[][];
  paths?: number[][];
  width?: number;
  nextPageRects?: number[][];
}

/** Dual anchor: Zotero rects for write-back, W3C locus for durability. */
export interface CombinedPdfAnchor {
  contentHash?: string;
  zoteroPosition?: ZoteroRectPosition;
  locus?: PdfLocus;
}

// --- github-repo-pdf-resolver ---
/**
 * GitHub repo ladder step: the PDF as a file in the workspace's GitHub repo.
 * The composition root turns a repo path into a fetchable URL (and holds any
 * token); this class only picks the path.
 */
export interface GitHubRepoPdfResolverOptions {
  /** URL for a repo-relative path, or null when no repo is set up. */
  buildFileUrl: (repoPath: string) => string | null;
}

export class GitHubRepoPdfResolver implements IPdfSourceResolver {
  readonly id = "github-repo";

  constructor(private readonly options: GitHubRepoPdfResolverOptions) {}

  supports(_paper: PdfSourcePaper): boolean {
    return true;
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const given = paper.metadata?.["pdfPath"];
    const path = rust().githubRepoPdfPath(typeof given === "string" ? given : undefined, paper.id);
    if (!path) return null;
    const url = this.options.buildFileUrl(path)?.trim();
    return url ? { url } : null;
  }
}

// --- ink-lasso ---
/** Types for ink-lasso. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/**
 * The lasso: which strokes a loop drawn round them has caught.
 *
 * The sheet's lasso is a polygon the hand draws, and the worker decides what is
 * inside it. A PDF page has the same gesture, so the rule lives here rather
 * than in the worker: one definition of "caught", callable from either surface
 * and testable without a canvas or a document.
 *
 * OneNote's rule is the one implemented: a stroke is caught when **most of its
 * points** are inside the loop, not when any part of it touches. A loop drawn
 * round a sentence must take the sentence, not every stroke whose tail happens
 * to cross the loop on its way somewhere else.
 */

/** The share of a stroke's points a loop must hold for it to be caught. */
export const LASSO_CAUGHT_SHARE = 0.6;

// --- ink-stroke ---
/** Types for ink-stroke. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/**
 * Hardest cap on one stroke. Reached only by a stroke that is genuinely long
 * and wiggly; the tolerance is raised until the stroke fits rather than the
 * tail being cut, so the shape degrades gracefully instead of losing its end.
 */
export const INK_MAX_POINTS = 400;

/**
 * How many strokes one annotation row may hold before the next stroke starts a
 * new row. Grouping is what stops a written sentence becoming twenty rows and
 * twenty sidebar entries; this bound stops it becoming one unbounded row.
 */
export const INK_MAX_PATHS_PER_ANNOTATION = 64;

export const INK_DEFAULT_WIDTH = 2;

/**
 * The rail's four nibs, in PDF points, derived from the ink note's set:
 * 0.28 / 0.85 / 1.42 / 1.98 pt.
 */
export const INK_NIB_WIDTHS_PT: readonly number[] = [0.28, 0.85, 1.42, 1.98];

/**
 * The rail's default nib, 0.5 mm. One step up from the ink note's 0.3 mm
 * (`INK_PEN_WIDTH`): a page of 10 pt type is read at a smaller scale than a
 * sheet of ruled paper, and 0.3 mm on it reads as a hairline.
 */
export const INK_NIB_DEFAULT_PT: number = 1.42;

/** Nib width of the highlighter tool, in PDF units. */
export const HIGHLIGHTER_WIDTH = 14;

/**
 * At or above this width an ink stroke is painted as a highlighter: translucent
 * and multiplied over the page rather than drawn on top of it.
 *
 * Zotero's ink annotation carries a `width` and nothing else — there is no
 * "tool" field to write back, and inventing one would either be dropped on sync
 * or corrupt the item for Zotero's own reader. Deriving the look from the width
 * keeps a highlighter a plain Zotero ink annotation that happens to be thick.
 */
export const HIGHLIGHTER_MIN_WIDTH = 8;

export interface InkGroupCandidate {
  pageIndex: number;
  color: string;
  width: number;
  /** Strokes the target annotation already holds. */
  pathCount: number;
  /** When the group last took a stroke. */
  lastAt: number;
}

// --- open-access-pdf-resolver ---
/**
 * Open-access / landing-URL PDF resolver — ladder step for public https PDFs.
 * Pure: no I/O beyond what the caller already put on the paper shape.
 */
export interface OpenAccessPdfResolverOptions {
  /**
   * Map paper fields → a PDF https URL, or null when none can be derived.
   * Injected so the web allowlist (`sanitizePdfUrl` / `looksLikePdfUrl`) stays
   * in the app layer while the resolver itself stays framework-free.
   */
  resolveUrl: (paper: PdfSourcePaper) => string | null;
}

export class OpenAccessPdfResolver implements IPdfSourceResolver {
  readonly id = "open-access";

  constructor(private readonly options: OpenAccessPdfResolverOptions) {}

  supports(paper: PdfSourcePaper): boolean {
    return rust().openAccessSupports(paper.arxivId, paper.url, paper.doi);
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const url = rust().trimmedOrNone(this.options.resolveUrl(paper));
    if (!url) return null;
    return { url };
  }
}

// --- page-projection-types ---
/** Page geometry for PDF-to-screen maths. The maths runs in Rust (`crates/wf-core/src/reader/viewport.rs`). */
export interface PageProjection {
  /** Unrotated page size in PDF user-space units. */
  pageWidth: number;
  pageHeight: number;
  scale: number;
  /** 0, 90, 180 or 270. Other values are normalised. */
  rotation: number;
}

// --- webdav-pdf-resolver ---
/**
 * WebDAV ladder step — credentials must be server-sealed; this resolver only
 * emits a sealed URL shape when metadata declares a path. No credentials here.
 */
export interface WebDavPdfResolverOptions {
  /**
   * Build a same-origin proxy URL for a WebDAV path. Composition root supplies
   * the sealed credential hop; this class never sees secrets.
   */
  buildProxiedUrl: (path: string) => string | null;
}

export class WebDavPdfResolver implements IPdfSourceResolver {
  readonly id = "webdav";

  constructor(private readonly options: WebDavPdfResolverOptions) {}

  supports(paper: PdfSourcePaper): boolean {
    const path = paper.metadata?.["webdavPath"];
    return rust().webdavSupports(typeof path === "string" ? path : undefined);
  }

  async resolve(paper: PdfSourcePaper): Promise<PdfSourceHit | null> {
    const path = rust().trimmedOrNone(String(paper.metadata?.["webdavPath"] ?? ""));
    if (!path) return null;
    const url = rust().trimmedOrNone(this.options.buildProxiedUrl(path));
    if (!url) return null;
    return { url };
  }
}

// --- zotero-write-back-types ---
/**
 * Types for the R5 Zotero write-back. The logic (sync decisions, field diffs,
 * conflict merge, payloads) runs in Rust (`crates/wf-core/src/reader/zotero_sync.rs`).
 */
/** Per-library write-back mode. */
export type ZoteroLibrarySyncMode = "bidirectional" | "read_only" | "ignored";

export interface ZoteroAnnotationRemote {
  key: string;
  version: number;
  type: ReaderAnnotationType;
  color: string;
  text: string;
  comment: string;
  tags: string[];
  anchor: CombinedPdfAnchor;
  sortIndex: string;
  updatedAt: string;
}

type AnnotationConflictField =
  | "color"
  | "text"
  | "comment"
  | "tags"
  | "anchor"
  | "type"
  | "sortIndex";

export interface AnnotationFieldConflict {
  field: AnnotationConflictField;
  local: unknown;
  remote: unknown;
}

export type AnnotationSyncDecision =
  | { kind: "push"; reason: string }
  | { kind: "pull"; reason: string }
  | { kind: "noop"; reason: string }
  | { kind: "conflict"; fields: AnnotationFieldConflict[]; reason: string }
  | { kind: "skip"; reason: string };

export interface AnnotationSyncRow {
  local: ReaderAnnotation & {
    syncState: AnnotationSyncState;
    zoteroVersion: number | null;
  };
  remote: ZoteroAnnotationRemote | null;
}

export type ConflictResolveChoice = "keep_local" | "accept_remote" | "merge";

/**
 * One annotation as Zotero's write API takes it. `annotationText` is only set
 * for text-bearing types and is left out for every other type.
 */
export interface ZoteroAnnotationWritePayload {
  itemType: "annotation";
  parentItem: string;
  annotationType: ReaderAnnotationType;
  annotationText?: string;
  annotationComment: string;
  annotationColor: string;
  annotationSortIndex: string;
  annotationPosition: string;
  tags: { tag: string }[];
}

export interface IZoteroAnnotationWriteBack {
  /**
   * Dry-run by default. Live implementations must require an explicit
   * `{ live: true }` flag and human-supervised credentials.
   */
  push(
    parentItemKey: string,
    annotations: readonly ReaderAnnotation[],
    options?: { live?: boolean },
  ): Promise<{ dryRun: boolean; payloads: ZoteroAnnotationWritePayload[] }>;
}
