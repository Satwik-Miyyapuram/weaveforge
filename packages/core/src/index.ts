/**
 * @weaveforge/core — shared, framework-agnostic domain contracts and types.
 *
 * This package owns the entities, repository interfaces, and use-cases. It has
 * no dependency on React, Next, supabase-js, or any I/O library. The web app and
 * the Python SDK both build on these contracts.
 */

export * from "./shared/errors.js";
export * from "./shared/parts.js";
export * from "./shared/parts.js";
export * from "./shared/parts.js";
export * from "./shared/parts.js";
export * from "./shared/markdown-image.js";
export * from "./shared/parts.js";
export * from "./shared/parts.js";
export { JSON_KINDS, rust, setRustCore, type JsonDiff, type JsonDiffEntry, type JsonRow, type ParsedJsonData, type VaultPageBase, type WorkspaceJsonKind } from "./shared/rust.js";
export * from "./shared/parts.js";
export type { OutboundFetchLimits, PageTitle, UrlCheck, UrlRejection } from "./shared/core-contract.js";
// config
export * from "./config/parts.js";
export * from "./config/parts.js";
// features/papers
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/application/parts-1.js";
export * from "./features/papers/application/parts-1.js";
export * from "./features/papers/application/update-paper.use-case.js";
export * from "./features/papers/application/parts-1.js";
export * from "./features/papers/application/parts-1.js";
export * from "./features/papers/application/parts-1.js";
// features/logbook
export * from "./features/logbook/domain/parts.js";
export * from "./features/logbook/domain/parts.js";
// features/report
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
// features/reading-lists
export * from "./features/reading-lists/domain/parts.js";
export * from "./features/reading-lists/domain/parts.js";
export * from "./features/reading-lists/domain/parts.js";
export * from "./features/reading-lists/domain/parts.js";
export * from "./features/reading-lists/application/parts.js";
export * from "./features/reading-lists/application/parts.js";
// features/relations
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/application/parts.js";
export * from "./features/relations/application/parts.js";
export * from "./features/relations/application/parts.js";
export { RemoveRelationUseCase } from "./features/relations/application/parts.js";
// features/settings
export * from "./features/settings/domain/parts.js";
export * from "./features/settings/domain/parts.js";
export * from "./features/settings/domain/parts.js";
export * from "./features/settings/domain/parts.js";
export { ManageSettingsUseCase } from "./features/settings/application/manage-settings.use-case.js";
// features/projects
export * from "./features/projects/domain/parts.js";
export * from "./features/projects/domain/parts.js";
// features/experiments
export * from "./features/experiments/domain/parts.js";
export * from "./features/experiments/domain/parts.js";
export * from "./features/experiments/domain/parts.js";
export * from "./features/experiments/domain/parts.js";
// features/plan
export * from "./features/plan/domain/parts.js";
export * from "./features/plan/domain/parts.js";
// features/org
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
// features/sharing
export type { Comment, CommentAnchor, NewCommentInput, NewShareInput, ResolvedShareLink, Share, ShareAccess, ShareableType, ShareLink, ShareLinkSaveInput, IShareLinkRepository, IShareLinkTokenHasher } from "./shared/core-contract.js";
export * from "./features/sharing/domain/parts.js";
export * from "./features/sharing/domain/parts.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/parts.js";
// features/tags
export * from "./features/tags/domain/parts.js";
export * from "./features/tags/domain/parts.js";
// features/integrations
export type {
  BibliographyAnnotation,
  BibliographyAnnotationPull,
  BibliographyCollection,
  BibliographyCredentials,
  BibliographySyncResult,
  IBibliographyIntegration,
  IProjectBibliographyCollectionStore,
  ILogSyncIntegration,
  INotificationIntegration,
} from "./features/integrations/domain/parts.js";
export type {
  IntegrationFieldDescriptor,
  UserIntegrationDescriptor,
} from "./features/integrations/domain/parts.js";
// features/dashboard
export * from "./features/dashboard/domain/parts.js";
export * from "./features/dashboard/domain/parts.js";
// features/vault
export type { NewVaultPageInput, ParsedFrontmatter, VaultPage, VaultPageFilter, VaultPageSummary, VaultPageTreeNode, WikilinkRef } from "./shared/core-contract.js";
export * from "./features/vault/domain/vault-page-repository.js";
// features/library
export * from "./features/library/domain/parts.js";
export * from "./features/library/domain/parts.js";
export * from "./features/library/application/parts.js";
export * from "./features/library/application/parts.js";
export * from "./features/library/application/parts.js";
export * from "./features/library/application/parts.js";
// features/collab
export * from "./features/collab/domain/crdt-update-store.js";
// features/ai-assistant
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/application/parts.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/application/parts.js";
export * from "./features/ai-assistant/application/parts.js";
export * from "./features/ai-assistant/application/parts.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/application/parts.js";
export * from "./features/ai-assistant/domain/parts.js";
// storage
export type { IBlobStore, IBlobFetcher } from "./storage/parts.js";
export { BlobNotFoundError } from "./storage/parts.js";
export type {
  BlobTier,
  BlobObjectRecord,
  IBlobRegistry,
  RegisterBlobInput,
} from "./storage/parts.js";
// features/reader
export type { OutlineTextItem, ReaderOutlineItem } from "./features/reader/parts.js";

export * from "./features/reader/analysis/analysis-types.js";
export { type TextLine } from "./features/reader/analysis/line-reconstruction.js";

// One rect maths for every mention: the one analysis itself uses.

export { type CitationCandidate as CitationTextCandidate } from "./shared/core-contract.js";
// reader
export {
  resolvePdfSource,
  type PdfSourcePaper,
  type PdfSourceHit,
  type IPdfSourceResolver,
  type PdfSourceResolution,
} from "./reader/parts.js";
export { OpenAccessPdfResolver, type OpenAccessPdfResolverOptions } from "./reader/parts.js";
export { WebDavPdfResolver, type WebDavPdfResolverOptions } from "./reader/parts.js";
export { GitHubRepoPdfResolver, type GitHubRepoPdfResolverOptions } from "./reader/parts.js";
export { type ReaderKeyboardCommand, type ReaderKeyEvent } from "./shared/core-contract.js";
export { READER_ANNOTATION_TYPES, type AnnotationOrigin, type ReaderAnnotationType, type ReaderAnnotation, type NewReaderAnnotation, type ReaderAnnotationPatch, type IReaderAnnotationSource, type IReaderAnnotationSink, type IReaderAnnotationSyncRecorder, type ReaderAnnotationSyncRecord, type IReaderAnnotationProjectSource, type AnnotationSyncState } from "./reader/parts.js";

export { INK_MAX_POINTS, INK_MAX_PATHS_PER_ANNOTATION, INK_DEFAULT_WIDTH, INK_NIB_WIDTHS_PT, INK_NIB_DEFAULT_PT, HIGHLIGHTER_WIDTH, HIGHLIGHTER_MIN_WIDTH, type InkGroupCandidate } from "./reader/parts.js";
export { LASSO_CAUGHT_SHARE } from "./reader/parts.js";
export { type InkUndoEntry, type InkUndoPatch, type InkUndoState } from "./shared/core-contract.js";
export type { PageProjection } from "./reader/parts.js";
export type {
  ZoteroLibrarySyncMode,
  ZoteroAnnotationRemote,
  AnnotationFieldConflict,
  AnnotationSyncDecision,
  AnnotationSyncRow,
  ConflictResolveChoice,
  ZoteroAnnotationWritePayload,
  IZoteroAnnotationWriteBack,
} from "./reader/parts.js";
export {
  InMemoryPdfByteCache,
  PdfByteCacheResolver,
  type IPdfByteCache,
} from "./reader/parts.js";
// ink
export { INK_WIDTH_UNITS_PER_MM, INK_PEN_WIDTHS, INK_PEN_WIDTH, INK_HIGHLIGHTER_WIDTH, INK_HIGHLIGHTER_WIDTHS, INK_HIGHLIGHTER_MIN_WIDTH, INK_MIN_WIDTH, INK_MAX_WIDTH, INK_VELOCITY_FULL_TAPER, INK_VELOCITY_TAPER, INK_PRESSURE_MIN_FACTOR, INK_PRESSURE_MAX_FACTOR } from "./ink/parts.js";

export { INK_ZOOM_MIN, INK_ZOOM_MAX, INK_ZOOM_STEP } from "./ink/parts.js";

export { INK_SMOOTH_SPACING, INK_SMOOTH_PASSES, type SmoothedInkStroke } from "./ink/parts.js";

export { INK_TOOLS, INK_COLOURS, INK_MARKER_COLOURS, INK_THEME_COLOURS, INK_PAPERS, INK_SHAPES, INK_HANDS, INK_A4_WIDTH, INK_A4_HEIGHT, INK_COORD_LIMIT, INK_STROKE_MAX_POINTS, INK_PAGE_STROKE_BUDGET, INK_NOTE_MAX_PAGES, INK_PACK_TOLERANCE, INK_PACK_PRESSURE_TOLERANCE, INK_NOTE_TYPE, INK_KEYS, INK_SIDECAR_DIR, INK_CHUNK_EXT, INK_BODY_HEADER, INK_BACKGROUND_ALT, type InkTool, type InkColour, type InkPaper, type InkShape, type InkHand, type InkStroke, type InkLineRecord, type InkPage, type InkNoteMeta, type PackedInkStroke } from "./ink/parts-2.js";

export type { InkStrokePackerOptions, LiveInkStrokePacker } from "./ink/parts.js";

export { FIGURE_ALT, type FigureGeometry, type FigureOrderStep, type FigureHandle, FIGURE_HANDLES } from "./ink/parts.js";

export {
  INK_CHUNK_MAGIC,
  INK_CHUNK_VERSION,
  INK_CHUNK_FLAG_COMPRESSED,
  INK_CHUNK_HEADER_BYTES,
  INK_NOTE_MAX_BYTES,
  INK_CHUNK_MAX_POINTS,
  INK_CHUNK_MAX_STROKES,
  InkChunkError,
  identityInkChunkCodec,
  encodeInkChunkBody,
  encodeInkChunk,
  readInkChunkHeader,
  inflateInkChunk,
  decodeInkChunkBody,
  decodeInkChunk,
  inkChunkBodySize,
  type InkChunkCodec,
  type InkChunkView,
  type InkChunkHeader,
} from "./ink/parts-1.js";

export {
  chunkStrokePoints,
  chunkLineText,
  chunkStroke,
  chunkLine,
  pageFromChunk,
  pageFromChunkBytes,
} from "./ink/parts-1.js";

export { INK_GROUP_WINDOW_MS, INK_LINE_BAND_RATIO, type InkSegmentation, type RecognisedLineText } from "./ink/parts.js";

export {
  INK_ENGINES,
  inkUnsureConfidence,
  selectInkRecogniser,
  isUnsureLine,
  mapInkConfidence,
  inkPageConfidence,
  inkVocabularyHints,
  type InkEngineId,
  type InkEnginePlatform,
  type InkLine,
  type RecognisedLine,
  type InkRecognitionHints,
  type InkRecogniser,
} from "./ink/parts-2.js";

export { INK_ENGINE_MAX_CONFIDENCE, type InkWordReadings } from "./ink/parts.js";
// workspace
export * from "./workspace/parts-2.js";
export * from "./workspace/parts-1.js";
export * from "./workspace/parts.js";
export * from "./workspace/parts-1.js";
export * from "./workspace/parts-2.js";
export * from "./workspace/parts-1.js";
export * from "./workspace/parts.js";
export * from "./workspace/parts-1.js";
export * from "./workspace/parts.js";
export * from "./workspace/parts-2.js";
// search
export * from "./search/parts.js";
export * from "./search/parts.js";
export * from "./search/parts.js";
export * from "./search/parts.js";
export * from "./search/parts.js";
// backend
export type { AuthUser, AuthChangeCallback, IAuthService } from "./backend/parts.js";
export type { ICurrentUserProvider } from "./backend/parts.js";
export type { IAdminUserProvisioner, ProvisionUserInput } from "./backend/parts.js";
// database
export * from "./database/local-postgres.js";
