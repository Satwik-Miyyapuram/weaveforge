/** The vocabulary the pdf-reader modules share. */
import type {
  AnchorConfidence,
  InkGroupCandidate,
  PdfLocus,
  QuotationType,
  ReaderAnnotation,
} from "@weaveforge/core";

export type PdfLib = typeof import("pdfjs-dist");

export type PdfDocument = Awaited<ReturnType<PdfLib["getDocument"]>["promise"]>;

export type RenderTask = ReturnType<Awaited<ReturnType<PdfDocument["getPage"]>>["render"]>;

/**
 * A mark being drawn right now, in PDF coordinates — either a freehand path
 * (flat x,y pairs, as `inkPath` holds them) or a dragged region.
 */
export type DraftShape =
  | { kind: "ink"; pageNumber: number; path: number[]; width: number; highlighter: boolean }
  | { kind: "rect"; pageNumber: number; x0: number; y0: number; x1: number; y1: number };

/** An ink annotation being extended stroke by stroke, so one mark is one row. */
export interface InkGroup extends InkGroupCandidate {
  annotationId: string;
}

/** A selected ink annotation being dragged to a new place on its page. */
export interface InkMove {
  annotationId: string;
  pointerId: number;
  pageNumber: number;
  /** Where the drag started, in PDF user space. */
  fromX: number;
  fromY: number;
  dx: number;
  dy: number;
}

/** A drawn text-annotation region waiting for the user to type its contents. */
export interface PendingTextBox {
  pageIndex: number;
  pageHeight: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface TextItemGeometry {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
}

export interface PageText {
  text: string;
  items: { start: number; end: number; index: number }[];
}

export interface PdfReaderProps {
  url: string;
  originalUrl?: string;
  locus?: PdfLocus;
  /** 0-based page hint; when present the jump resolves there first. */
  page?: number;
  /** Projected reader annotations (Zotero and/or local). */
  annotations?: import("@weaveforge/core").ReaderAnnotation[];
  /**
   * Hash of the PDF being rendered, when the source ladder knows it. Stored
   * annotation rects are only trusted against a matching hash; empty on both
   * sides means "unnamed local file", which is trusted.
   */
  contentHash?: string;
  paperTitle?: string;
  quotationTypes?: Map<string, QuotationType>;
  /** When set, selection can create local annotations (R3 sink). */
  paperId?: string;
  onAnnotationsChange?: (
    next: ReaderAnnotation[] | ((prev: ReaderAnnotation[]) => ReaderAnnotation[]),
  ) => void;
  onActivity?: (kind: string, message: string) => void;
  /**
   * Called instead of showing an error when a locally cached copy fails to
   * open, so the owner can evict it and retry from the network.
   */
  onSourceFailure?: (failedUrl: string) => void;
}

export interface JumpState {
  status: "idle" | "searching" | "found" | "low" | "missed";
  pageNumber?: number;
  confidence?: AnchorConfidence;
}
