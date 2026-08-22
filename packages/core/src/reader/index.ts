export type {
  TextQuoteSelector,
  TextPositionSelector,
  PdfLocus,
} from "./pdf-locus.js";
export {
  normaliseWhitespace,
  findQuoteMatches,
  pickNearestMatch,
  resolvePositionSelector,
  resolveTextAnchor,
  type TextSpan,
  type AnchorConfidence,
  type ResolvedAnchor,
} from "./anchor-resolution.js";
export {
  chooseAnchorStrategy,
  type ZoteroRectPosition,
  type CombinedPdfAnchor,
  type AnchorStrategy,
} from "./anchor-strategy.js";
export {
  resolvePdfSource,
  type PdfSourcePaper,
  type PdfSourceHit,
  type IPdfSourceResolver,
  type PdfSourceResolution,
} from "./pdf-source-ladder.js";
export { OpenAccessPdfResolver, type OpenAccessPdfResolverOptions } from "./open-access-pdf-resolver.js";
export { WebDavPdfResolver, type WebDavPdfResolverOptions } from "./webdav-pdf-resolver.js";
export {
  parseEpubCfi,
  isEpubCfiLocus,
  buildHtmlSnapshotLocus,
  paperPdfBucketAllowsUpload,
  DEFAULT_PAPER_PDF_BUCKET_POLICY,
  R6_DEFERRALS,
  type EpubCfiLocus,
  type CombinedEpubAnchor,
  type HtmlSnapshotLocus,
  type PaperPdfBucketPolicy,
} from "./format-reach.js";
export {
  clampScale,
  clampPage,
  computeFitWidthScale,
  computeFitPageScale,
  visualPageSize,
  zoomIn,
  zoomOut,
  nextRotation,
  resolveViewportScale,
  initialReaderViewport,
  READER_MIN_SCALE,
  READER_MAX_SCALE,
  type ReaderFitMode,
  type ReaderRotation,
  type ReaderPageSize,
  type ReaderContainerSize,
  type ReaderViewportState,
} from "./reader-viewport.js";
export {
  readerKeyboardCommand,
  isEditableReaderTarget,
  type ReaderKeyboardCommand,
  type ReaderKeyEvent,
} from "./reader-keyboard.js";
export {
  READER_ANNOTATION_TYPES,
  isReaderAnnotationType,
  isAnnotationSyncState,
  type AnnotationOrigin,
  type ReaderAnnotationType,
  type ReaderAnnotation,
  type NewReaderAnnotation,
  type ReaderAnnotationPatch,
  type IReaderAnnotationSource,
  type IReaderAnnotationSink,
  type IReaderAnnotationProjectSource,
  type AnnotationSyncState,
} from "./reader-annotation.js";
export {
  selectionToAnchor,
  itemToRect,
  type PageTextItem,
  type PageTextGeometry,
  type TextSelectionRange,
} from "./selection-to-anchor.js";
export {
  findDocumentMatches,
  nextMatchIndex,
  type DocumentPageText,
  type DocumentSearchMatch,
} from "./document-search.js";
export { buildAnnotationSortIndex } from "./sort-index.js";
export {
  shouldAppendInkPoint,
  simplifyInkPath,
  quantizeInkPath,
  compactInkPath,
  inkPathJsonSize,
  inkWidthForPressure,
  meanPressure,
  clampInkWidth,
  isHighlighterInk,
  canJoinInkGroup,
  inkPathsHitTest,
  inkPathsBounds,
  translateInkPaths,
  INK_MAX_POINTS,
  INK_MAX_PATHS_PER_ANNOTATION,
  INK_DEFAULT_WIDTH,
  HIGHLIGHTER_WIDTH,
  HIGHLIGHTER_MIN_WIDTH,
  type InkGroupCandidate,
} from "./ink-stroke.js";
export {
  pdfPointToScreen,
  screenPointToPdf,
  pdfRectToScreenBox,
  projectedPageSize,
  normalisePageRotation,
  type PageProjection,
} from "./page-projection.js";
export {
  decideAnnotationSync,
  diffAnnotationFields,
  resolveAnnotationConflict,
  toZoteroWritePayload,
  DryRunZoteroAnnotationWriteBack,
  isZoteroLibrarySyncMode,
  type ZoteroLibrarySyncMode,
  type ZoteroAnnotationRemote,
  type AnnotationFieldConflict,
  type AnnotationSyncDecision,
  type AnnotationSyncRow,
  type ConflictResolveChoice,
  type ZoteroAnnotationWritePayload,
  type IZoteroAnnotationWriteBack,
} from "./zotero-write-back.js";
export {
  InMemoryPdfByteCache,
  PdfByteCacheResolver,
  type IPdfByteCache,
} from "./pdf-byte-cache.js";
export { encodeLocus, decodeLocus } from "./locus-link.js";
