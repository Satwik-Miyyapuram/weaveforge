/**
 * Constants and TS-only types the Rust exports cannot carry: wasm-bindgen exports no consts,
 * and these narrow types have no Rust twin. Re-exported by feature-wrappers.ts.
 */
import type { AiPolicyDenyReason, AnchorConfidence, CreateKind, DependencyKind, EditableRoot, GraphNode, InkStroke, InkUndoState, LogKind, MilestoneStatus, RelationType, SearchField, PdfIndexSource as StoredPdfIndexSource, PdfPageText as StoredPdfPageText, ReaderFitMode, TextSpan, UserSettings } from "./bindings.js";

/**
 * Plain TypeScript types for the reader modules whose logic is in Rust. They
 * keep the shapes the deleted TypeScript modules (pdf-locus, reader-viewport) used,
 * so callers that narrow on `quote` keep their types; the generated bindings
 * are looser (every field optional or nullable).
 */
/** Primary anchor: quote + optional context snippets (W3C TextQuoteSelector). */
export interface TextQuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
}

/**
 * Fallback anchor: character offsets into extracted page/document text
 * (W3C TextPositionSelector). Brittle across re-extraction; keep as hint.
 */
export interface TextPositionSelector {
  type: "TextPositionSelector";
  start: number;
  end: number;
}

/**
 * A stored locus for jump-to-source. Rects (when present elsewhere) are
 * rendering hints only — never the authoritative anchor.
 */
export interface PdfLocus {
  quote: TextQuoteSelector;
  position?: TextPositionSelector;
}

/** One pdf.js text item in PDF user space (origin bottom-left). */
export interface PageTextItem {
  str: string;
  /** pdf.js transform `[a,b,c,d,e,f]`; e,f are the origin of the glyph run. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  /** pdf.js font name, when the caller carries it. */
  fontName?: string;
}

/** Page text items plus page size, the input to selection-to-anchor. */
export interface PageTextGeometry {
  /** Zero-based page index. */
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  items: readonly PageTextItem[];
  contentHash?: string;
}

/** A text-layer selection, by item index and character offset. */
export interface TextSelectionRange {
  startItemIndex: number;
  startOffset: number;
  endItemIndex: number;
  endOffset: number;
}

/** Smallest zoom the reader allows. */
export const READER_MIN_SCALE = 0.25;

/** Largest zoom the reader allows. */
export const READER_MAX_SCALE = 4;

/** One page's extracted text, as document search reads it. */
export interface DocumentPageText {
  /** Zero-based page index. */
  pageIndex: number;
  text: string;
}

/** A hit in a page's text. Offsets are UTF-16 code units. */
export interface DocumentSearchMatch {
  pageIndex: number;
  /** Inclusive start offset into that page's text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

/** Page rotation in degrees. */
export type ReaderRotation = 0 | 90 | 180 | 270;

/** PDF page size in user-space units (at scale 1, rotation 0). */
export interface ReaderPageSize {
  width: number;
  height: number;
}

/** Container size in CSS pixels. */
export interface ReaderContainerSize {
  width: number;
  height: number;
}

/** The reader's zoom, fit and rotation state. */
export interface ReaderViewportState {
  scale: number;
  fit: ReaderFitMode;
  rotation: ReaderRotation;
  page: number;
}

/** A span with how it was found. */
export interface ResolvedAnchor extends TextSpan {
  via: "quote" | "position";
  confidence: AnchorConfidence;
}

/** Zotero `annotationPosition` shape. */
export interface ZoteroRectPosition {
  /** Zero-based page index from Zotero. */
  pageIndex: number;
  /** PDF user-space rects `[x1, y1, x2, y2]`. */
  rects?: number[][];
  /** Ink strokes, flat `[x,y,x,y,...]` point lists in PDF user space. */
  paths?: number[][];
  /** Nib width for `paths`, in PDF units. */
  width?: number;
  /** Tail of a highlight that crosses onto the next page. */
  nextPageRects?: number[][];
}

/** Dual anchor: Zotero rects for write-back interop, W3C locus for durability. */
export interface CombinedPdfAnchor {
  /** Hash of the PDF file the Zotero rects were captured against. */
  contentHash?: string;
  /** Zotero page/rects, trustworthy only while the hash still matches. */
  zoteroPosition?: ZoteroRectPosition;
  /** W3C quote (+ optional position) for re-resolution across files. */
  locus?: PdfLocus;
}

/** Which anchor to trust for the current PDF. */
export type AnchorStrategy =
  | { kind: "rects"; position: ZoteroRectPosition; confidence: "high" }
  | { kind: "quote"; locus: PdfLocus; confidence: "low" }
  | { kind: "none"; confidence: "low" };


/** One PDF page's extracted text. */
export type PdfPageText = Required<StoredPdfPageText>;

/** A paper's extracted PDF text, as callers send it. Rust also accepts a partial one. */
export type PdfIndexSource = Required<Omit<StoredPdfIndexSource, "pages">> & {
  pages: readonly PdfPageText[];
};


/**
 * Search settings helpers (Rust `search_settings`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/parts.ts.
 */
/** Weights outside this range stop being a preference and become a bug. */
export const MIN_FIELD_WEIGHT = 0;
export const MAX_FIELD_WEIGHT = 20;

/** Multiplier applied to a downranked kind. Enough to sink, not to hide. */
export const DOWNRANK_FACTOR = 0.25;

// --- user-settings ---
/**
 * User settings row helpers (Rust `settings::user_settings`), re-exported from index.ts.
 * Keep the signatures of packages/core/src/features/settings/domain/parts.ts and
 * applyUserIntegrationFields from user-integration-credentials.ts. Types come from ./bindings.ts.
 */
export const EMPTY_SETTINGS: UserSettings = {};

/** A draft row: what it will make and where it sits. */
export interface Draft {
  kind: CreateKind;
  root: EditableRoot;
  /** The parent note or section; `null` puts it at the root. */
  parentId: string | null;
}

/** Which explorer sections are open. Anything not in the set is closed. */
export interface SectionState {
  open: ReadonlySet<string>;
}

/** A graph node, with the layout fields the force graph writes in place. */
export type GNode = GraphNode & { x?: number; y?: number; fx?: number; fy?: number };

/** An empty ink undo history. */
export const EMPTY_INK_UNDO: InkUndoState = { undo: [], redo: [] };

export const MILESTONE_STATUSES: readonly MilestoneStatus[] = ["planned", "in_progress", "done", "blocked"];
export const DEPENDENCY_KINDS: readonly DependencyKind[] = ["milestone", "experiment", "paper", "external"];

export const RELATION_TYPES: readonly RelationType[] = [
  "cites",
  "extends",
  "contradicts",
  "similar",
  "builds_on",
  "uses_method",
];

export const LOG_KINDS: readonly LogKind[] = ["daily", "weekly"];

/** Weight of the vector list in hybrid fusion; the keyword list is 1. */
export const HYBRID_VECTOR_WEIGHT = 1.5;

export const SEARCH_FIELDS: SearchField[] = ["title", "aliases", "headings", "tags", "path", "body"];

/** Terms shorter than this are matched exactly; prefix matching needs length. */
export const MIN_PREFIX_LENGTH = 3;

/** Corpus size past which the client index is likely to strain. */
export const LARGE_CORPUS_WARNING = 5_000;

/** The tab-group colour slots. */
export const GROUP_COLORS = [1, 2, 3, 4, 5, 6] as const;

/**
 * Reader annotations as callers see them: literal unions and required fields where the
 * generated bindings are looser. Mirrors packages/core/src/reader/parts.ts.
 */
export interface ReaderAnnotation {
  id: string;
  origin: "zotero" | "local";
  zoteroKey: string | null;
  type: "highlight" | "underline" | "note" | "image" | "ink" | "text";
  color: string;
  text: string;
  comment: string;
  tags: string[];
  anchor: CombinedPdfAnchor;
  sortIndex: string;
  createdAt: string;
  updatedAt: string;
  syncState?: "local" | "synced" | "pending" | "conflict";
  zoteroVersion?: number;
}

/** A reader annotation about to be created. */
export interface NewReaderAnnotation {
  id?: string;
  type: ReaderAnnotation["type"];
  color: string;
  text?: string;
  comment?: string;
  tags?: string[];
  anchor: CombinedPdfAnchor;
  sortIndex?: string;
  pageIndex: number;
}

/** The part of a mention the citation planner needs; `kind` is a literal union. */
export interface CiteSpan {
  key: string;
  start: number;
  end: number;
  text?: string;
  label?: string;
  kind?: "citation" | "figure" | "url";
  url?: string;
}

/** One piece of a run, split at mention boundaries. */
export interface TextSegment {
  from: number;
  to: number;
  text: string;
  mention?: CiteSpan;
}

/** The page text item shape the citation planner reads. */
export interface CitationPageTextItem {
  str: string;
  hasEOL?: boolean;
}

/** An ink stroke whose point arrays may be readonly, for inputs Rust only reads. */
export type ReadonlyInkStroke = Omit<InkStroke, "points" | "pressures"> & {
  readonly points: readonly number[];
  readonly pressures: readonly number[];
};

/** An AI access decision; `reason` exists only on a denial. */
export type AiPolicyDecision = { allowed: true } | { allowed: false; reason: AiPolicyDenyReason };
