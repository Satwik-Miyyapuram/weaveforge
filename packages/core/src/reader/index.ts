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
  READER_DEFAULT_SCALE,
  READER_MIN_SCALE,
  READER_MAX_SCALE,
  READER_ZOOM_STEP,
  type ReaderFitMode,
  type ReaderRotation,
  type ReaderPageSize,
  type ReaderContainerSize,
  type ReaderViewportState,
} from "./reader-viewport.js";
export {
  readerKeyboardCommand,
  type ReaderKeyboardCommand,
  type ReaderKeyEvent,
} from "./reader-keyboard.js";
export { encodeLocus, decodeLocus } from "./locus-link.js";
