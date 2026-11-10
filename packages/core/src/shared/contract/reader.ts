/** Reader and ink Rust function signatures (undo, citations, columns, keys, links). */
import type { ReaderAnnotation } from "../../reader/reader-annotation.js";
import type { PageTextItem } from "../../features/reader/page-text-item.js";
import type { CitationMention, PageTextRange, ParsedReference, PdfLink } from "../../features/reader/analysis/analysis-types.js";
import type { TextLine } from "../../features/reader/analysis/line-reconstruction.js";

/** One undoable step (ink undo stack). A new step is a new branch; see `InkUndoFns`. */
export type InkUndoEntry =
  /** A stroke was created; undo removes it, redo creates it again. */
  | { kind: "create"; annotation: ReaderAnnotation }
  /** A stroke was erased; undo creates it again, redo removes it. */
  | { kind: "remove"; annotation: ReaderAnnotation }
  /** Several marks were deleted together; undo recreates all, redo removes all. */
  | { kind: "removeMany"; annotations: ReaderAnnotation[] }
  /** A mark's paths were rewritten (a stroke joined it, or it was moved). */
  | {
      kind: "anchor";
      id: string;
      before: ReaderAnnotation["anchor"];
      after: ReaderAnnotation["anchor"];
    }
  /** A mark's colour, comment, tags or text changed; each side holds the fields it set. */
  | { kind: "update"; id: string; before: InkUndoPatch; after: InkUndoPatch };

/** The fields an edit can change, as `updateLocal` takes them. */
export type InkUndoPatch = Partial<Pick<ReaderAnnotation, "color" | "comment" | "tags" | "text">>;

export interface InkUndoState {
  undo: readonly InkUndoEntry[];
  redo: readonly InkUndoEntry[];
}

/** Signatures of the ink undo functions that moved to the Rust core (wf-wasm). */
export interface InkUndoFns {
  readonly EMPTY_INK_UNDO: InkUndoState;
  /** How many steps are kept. A page of handwriting is a few hundred strokes. */
  readonly INK_UNDO_LIMIT: 200;
  /** Record a step. A new step is a new branch: whatever was redoable is gone. */
  pushInkUndo(state: InkUndoState, entry: InkUndoEntry): InkUndoState;
  /** The step to undo, moved onto the redo stack; `null` when there is none. */
  takeInkUndo(state: InkUndoState): { state: InkUndoState; entry: InkUndoEntry } | null;
  /** The step to redo, moved back onto the undo stack; `null` when there is none. */
  takeInkRedo(state: InkUndoState): { state: InkUndoState; entry: InkUndoEntry } | null;
  /**
   * A row was recreated under a new id: point every step at the new one.
   * Both stacks are rewritten, because an entry on either side may still name
   * the row: the create that first made it, an anchor rewrite that joined a
   * stroke to it, the removal being undone right now.
   */
  renameInkUndoId(state: InkUndoState, from: string, to: string): InkUndoState;
  /**
   * A row was rewritten outside the stack (a stroke joined it): keep the
   * snapshot every entry holds current, so recreating it after an erase brings
   * back the whole mark and not the first stroke of it.
   */
  refreshInkUndoAnnotation(state: InkUndoState, annotation: ReaderAnnotation): InkUndoState;
}

/** One PDF text item, with the optional font metrics the citation code reads. */
export type PdfItem = PageTextItem & { fontAscent?: number; fontDescent?: number };

export interface SearchText {
  text: string;
  starts: number[];
  ends: number[];
}

/** One citation found in the text: a numeric marker or an author-year pair. */
export interface CitationCandidate {
  start: number;
  end: number;
  text: string;
  source: "numeric" | "author-year";
  authors?: string;
  year?: string;
}

/** Signatures of the citation-text functions that moved to the Rust core (wf-wasm). */
export interface CitationTextFns {
  stripInvisible(text: string): string;
  /** "Ball\u00B4e" and "Ball\u00B4 e" become "Ball\u00E9"; an accent before anything but a letter stays. */
  composeSpacingAccents(text: string): string;
  fontSizeOf(item: PdfItem): number;
  searchTextFromItems(items: readonly PdfItem[]): SearchText;
  originalRange(view: SearchText, start: number, end: number): [number, number];
  citationItemToRect(item: PdfItem, from?: number, to?: number): number[] | null;
  mentionRects(items: readonly PdfItem[], start: number, end: number): number[][];
  surnameKey(name: string): string;
  rectanglesOverlap(a: readonly number[], b: readonly number[]): boolean;
}

/** Signatures of the citation functions that moved to the Rust core (wf-wasm). */
export interface CitationsFns {
  matchAuthorYearText(text: string, refs: readonly ParsedReference[]): number[];
  inReferenceList(page: number, start: number, end: number, ranges: readonly PageTextRange[]): boolean;
  findCitationCandidates(items: readonly PdfItem[]): CitationCandidate[];
  findPatternCitationMentions(page: { number: number; text: string; items: readonly PdfItem[] }, refs: readonly ParsedReference[], excluded?: readonly PageTextRange[], candidates?: readonly CitationCandidate[]): CitationMention[];
}

/** Signatures of the column functions that moved to the Rust core (wf-wasm). */
export interface ColumnDetectionFns {
  /**
   * Column index (0-based) for each supplied line, all on one page. Lines whose
   * margin fits no dominant column take the nearest one, so a paragraph indent
   * never spawns a column of its own.
   */
  detectColumns(lines: readonly TextLine[]): number[];
  /**
   * Reading order over already-column-tagged lines: page, then column, then top
   * to bottom (PDF baselines grow upward, so larger `y` first).
   */
  sortByReadingOrder<T extends TextLine>(tagged: readonly { line: T; column: number }[]): T[];
}
/** A viewport command for a navigable key (tagged by `type`). */
export type ReaderKeyboardCommand =
  | { type: "page_delta"; delta: number }
  | { type: "page_home" }
  | { type: "page_end" }
  | { type: "zoom_in" }
  | { type: "zoom_out" }
  | { type: "fit_width" }
  | { type: "rotate" };

/** The keyboard event fields the reader reads. */
export interface ReaderKeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True when the event target is an editable field. */
  fromEditable?: boolean;
}

/** Signatures of the reader keyboard functions that moved to the Rust core (wf-wasm). */
export interface ReaderKeyboardFns {
  /**
   * Whether an event target owns its keystrokes: INPUT, TEXTAREA, SELECT or
   * OPTION in any case, or anything contenteditable.
   */
  isEditableReaderTarget(
    target: EventTarget | { tagName?: string; isContentEditable?: boolean } | null | undefined,
  ): boolean;
  /**
   * Return a command for navigable keys, or null when the event should pass through.
   * Ignores events from editable fields so page-jump inputs keep working.
   */
  readerKeyboardCommand(event: ReaderKeyEvent): ReaderKeyboardCommand | null;
}
/** Signatures of the reader link-citation functions that moved to the Rust core (wf-wasm). */
export interface LinkCitationsFns {
  /**
   * The reference entry a link destination lands on: the entry on that page
   * whose first line starts at or just below the destination point. `/XYZ`
   * destinations from hyperref sit a little above the entry's baseline, so the
   * nearest entry *below* the point (with a small tolerance) is the one meant;
   * in two-column layouts the same `y` occurs in both columns, so an entry in
   * the destination's column wins over one in the other.
   */
  referenceForDestination(dest: { page: number; x?: number; y?: number }, refs: readonly ParsedReference[]): ParsedReference | null;
  /**
   * The text spans a set of link boxes covers, under the page-text convention
   * (items concatenated, a newline after each `hasEOL` item). A text item under
   * a box contributes the part of itself the box covers, proportionally by
   * character; a link that covers the `16` of `[16]` gives `16`. Adjacent
   * links in one bracket (`[5, 2, 35]` is three links) keep separate spans.
   * `[38, 2, 9]` is one text item under three links; a box's proportional span
   * can take a neighbour's comma or bracket with it, so edges are trimmed of
   * separators and the caller widens back to brackets that belong to the span.
   */
  coveredTextSpans(page: { number: number; items: readonly PageTextItem[] }, links: readonly PdfLink[]): { spans: CoveredTextSpan[]; text: string };
  /**
   * Citation mentions from a page's links: for each internal link that resolves
   * to an entry, the span of page text under its box. The document's own links
   * are authoritative: a LaTeX PDF has a real `/Link` over `[16]`, and that is
   * trusted before any regex parsing. Links that cover no text (an empty box, a
   * figure) give nothing; each mention carries its source and full confidence.
   */
  linkCitationMentions(page: { number: number; items: readonly PageTextItem[] }, links: readonly PdfLink[], refs: readonly ParsedReference[]): CitationMention[];
}

/** A span of page text one link covers. Offsets are into the page-text convention string, trimmed of separators. */
export interface CoveredTextSpan {
  link: PdfLink;
  start: number;
  end: number;
}

/** Signatures of the text-fingerprint function that moved to the Rust core (wf-wasm). */
export interface TextFingerprintFns {
  /**
   * A stable key for a document's text layer: sixteen hex characters from two
   * FNV-1a passes over the pages. Two copies of the same paper hash the same
   * when their text layers agree, so a reference lookup done for one serves the
   * other, and a re-upload of the same file never re-resolves. Synchronous, so
   * it can run where SubtleCrypto cannot.
   */
  textFingerprint(texts: readonly string[]): string;
}

/** Signatures of the title-similarity functions that moved to the Rust core (wf-wasm). */
export interface TitleSimilarityFns {
  /** Token-set Dice similarity, insensitive to punctuation, accents and word order. */
  titleSimilarity(left: string, right: string): number;
  isBibliographicMatch(hints: { title?: string; year?: number }, candidate: { title: string; year?: number }): boolean;
}
