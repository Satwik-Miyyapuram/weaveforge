export {
  resolvePdfSource,
  type PdfSourcePaper,
  type PdfSourceHit,
  type IPdfSourceResolver,
  type PdfSourceResolution,
} from "./pdf-source-ladder.js";
export { OpenAccessPdfResolver, type OpenAccessPdfResolverOptions } from "./open-access-pdf-resolver.js";
export { WebDavPdfResolver, type WebDavPdfResolverOptions } from "./webdav-pdf-resolver.js";
export { GitHubRepoPdfResolver, type GitHubRepoPdfResolverOptions } from "./github-repo-pdf-resolver.js";
export { type ReaderKeyboardCommand, type ReaderKeyEvent } from "../shared/core-contract.js";
export { READER_ANNOTATION_TYPES, type AnnotationOrigin, type ReaderAnnotationType, type ReaderAnnotation, type NewReaderAnnotation, type ReaderAnnotationPatch, type IReaderAnnotationSource, type IReaderAnnotationSink, type IReaderAnnotationSyncRecorder, type ReaderAnnotationSyncRecord, type IReaderAnnotationProjectSource, type AnnotationSyncState } from "./reader-annotation.js";

export { INK_MAX_POINTS, INK_MAX_PATHS_PER_ANNOTATION, INK_DEFAULT_WIDTH, INK_NIB_WIDTHS_PT, INK_NIB_DEFAULT_PT, HIGHLIGHTER_WIDTH, HIGHLIGHTER_MIN_WIDTH, type InkGroupCandidate } from "./ink-stroke.js";
export { LASSO_CAUGHT_SHARE } from "./ink-lasso.js";
export { type InkUndoEntry, type InkUndoPatch, type InkUndoState } from "../shared/core-contract.js";
export type { PageProjection } from "./page-projection-types.js";
export type {
  ZoteroLibrarySyncMode,
  ZoteroAnnotationRemote,
  AnnotationFieldConflict,
  AnnotationSyncDecision,
  AnnotationSyncRow,
  ConflictResolveChoice,
  ZoteroAnnotationWritePayload,
  IZoteroAnnotationWriteBack,
} from "./zotero-write-back-types.js";
export {
  InMemoryPdfByteCache,
  PdfByteCacheResolver,
  type IPdfByteCache,
} from "./pdf-byte-cache.js";

