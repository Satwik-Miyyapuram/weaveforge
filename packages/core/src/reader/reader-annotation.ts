import type { CombinedPdfAnchor } from "./anchor-strategy.js";

/** Provenance of an annotation shown in the reader. */
export type AnnotationOrigin = "zotero" | "local";

/**
 * Zotero's complete annotation type set — see zotero/zotero annotations.js.
 * There is no `strikeout`. Local types must be a subset of this set (R3 rule).
 */
export type ReaderAnnotationType =
  | "highlight"
  | "underline"
  | "note"
  | "image"
  | "ink"
  | "text";

export const READER_ANNOTATION_TYPES: readonly ReaderAnnotationType[] = [
  "highlight",
  "underline",
  "note",
  "image",
  "ink",
  "text",
] as const;

export function isReaderAnnotationType(value: string): value is ReaderAnnotationType {
  return (READER_ANNOTATION_TYPES as readonly string[]).includes(value);
}

export interface ReaderAnnotation {
  id: string;
  origin: AnnotationOrigin;
  /** Zotero item key when origin === "zotero"; null for local-only. */
  zoteroKey: string | null;
  type: ReaderAnnotationType;
  color: string;
  /** Selected text (empty for ink/image). */
  text: string;
  comment: string;
  tags: string[];
  /** Rects for fidelity, locus for durability. Both, always when possible. */
  anchor: CombinedPdfAnchor;
  /** Zotero's ordering key, or a synthesised equivalent for local ones. */
  sortIndex: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewReaderAnnotation {
  type: ReaderAnnotationType;
  color: string;
  text?: string;
  comment?: string;
  tags?: string[];
  anchor: CombinedPdfAnchor;
  sortIndex?: string;
  pageIndex: number;
}

export interface ReaderAnnotationPatch {
  color?: string;
  text?: string;
  comment?: string;
  tags?: string[];
  anchor?: CombinedPdfAnchor;
  sortIndex?: string;
}

/** Read port — R1 wires a source; creation affordances appear only when a sink exists. */
export interface IReaderAnnotationSource {
  list(paperId: string): Promise<ReaderAnnotation[]>;
}

/** Write port — local-only in R3; Zotero-backed in R5. */
export interface IReaderAnnotationSink {
  create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation>;
  update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation>;
  remove(id: string): Promise<void>;
}
