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
export * from "./features/papers/domain/paper.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/domain/paper-field.js";
export * from "./features/papers/domain/parts.js";
export * from "./features/papers/application/metadata-source.js";
export * from "./features/papers/application/add-paper.use-case.js";
export * from "./features/papers/application/update-paper.use-case.js";
export * from "./features/papers/application/manage-paper-fields.use-case.js";
export * from "./features/papers/application/push-paper-to-zotero.use-case.js";
export * from "./features/papers/application/open-access.js";
// features/logbook
export * from "./features/logbook/domain/log-entry.js";
export * from "./features/logbook/domain/log-entry-repository.js";
export * from "./features/logbook/application/add-log-entry.use-case.js";
// features/report
export * from "./features/report/domain/report-section.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/domain/parts.js";
export * from "./features/report/application/manage-report-section.use-case.js";
// features/reading-lists
export * from "./features/reading-lists/domain/reading-list.js";
export * from "./features/reading-lists/domain/parts.js";
export * from "./features/reading-lists/domain/screening.js";
export * from "./features/reading-lists/domain/parts.js";
export * from "./features/reading-lists/application/screen-items.use-case.js";
export * from "./features/reading-lists/application/manage-reading-list.use-case.js";
// features/relations
export * from "./features/relations/domain/paper-relation.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/graph-view-settings.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/domain/parts.js";
export * from "./features/relations/application/parts.js";
export * from "./features/relations/application/check-citation-alerts.use-case.js";
export * from "./features/relations/application/manage-relations.use-case.js";
export { RemoveRelationUseCase } from "./features/relations/application/parts.js";
// features/settings
export * from "./features/settings/domain/parts.js";
export * from "./features/settings/domain/parts.js";
export * from "./features/settings/domain/parts.js";
export * from "./features/settings/domain/theme-config.js";
export { ManageSettingsUseCase } from "./features/settings/application/manage-settings.use-case.js";
// features/projects
export * from "./features/projects/domain/project.js";
export * from "./features/projects/domain/project-repository.js";
export * from "./features/projects/application/manage-project.use-case.js";
// features/experiments
export * from "./features/experiments/domain/experiment.js";
export * from "./features/experiments/domain/parts.js";
export * from "./features/experiments/domain/parts.js";
export * from "./features/experiments/domain/parts.js";
export * from "./features/experiments/application/manage-experiment.use-case.js";
// features/plan
export * from "./features/plan/domain/milestone.js";
export * from "./features/plan/domain/milestone-repository.js";
export * from "./features/plan/application/manage-milestone.use-case.js";
// features/org
export * from "./features/org/domain/member.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/domain/organization.js";
export * from "./features/org/domain/parts.js";
export * from "./features/org/application/create-member.use-case.js";
// features/sharing
export type { Comment, CommentAnchor, NewCommentInput, NewShareInput, ResolvedShareLink, Share, ShareAccess, ShareableType, ShareLink, ShareLinkSaveInput, IShareLinkRepository, IShareLinkTokenHasher } from "./shared/core-contract.js";
export * from "./features/sharing/domain/parts.js";
export * from "./features/sharing/domain/parts.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/create-share-link.use-case.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/parts.js";
export * from "./features/sharing/application/parts.js";
// features/tags
export * from "./features/tags/domain/parts.js";
export * from "./features/tags/domain/parts.js";
export * from "./features/tags/application/manage-tags.use-case.js";
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
export * from "./features/dashboard/domain/dashboard-layout.js";
export * from "./features/dashboard/domain/parts.js";
// features/vault
export type { NewVaultPageInput, ParsedFrontmatter, VaultPage, VaultPageFilter, VaultPageSummary, VaultPageTreeNode, WikilinkRef } from "./shared/core-contract.js";
export * from "./features/vault/domain/vault-page-repository.js";
export * from "./features/vault/application/manage-vault-page.use-case.js";
// features/library
export * from "./features/library/domain/parts.js";
export * from "./features/library/domain/parts.js";
export * from "./features/library/application/parts.js";
export * from "./features/library/application/merge-pinned-screen-data.js";
export * from "./features/library/application/parts.js";
export * from "./features/library/application/duplicate-shared-paper.use-case.js";
// features/collab
export * from "./features/collab/domain/crdt-update-store.js";
export * from "./features/collab/application/compact-crdt-log.use-case.js";
// features/ai-assistant
export * from "./features/ai-assistant/domain/ai-types.js";
export * from "./features/ai-assistant/application/create-ai-session-grant.use-case.js";
export * from "./features/ai-assistant/domain/ai-write-proposal.js";
export * from "./features/ai-assistant/application/append-paper-note.use-case.js";
export * from "./features/ai-assistant/application/execute-ai-proposal.use-case.js";
export * from "./features/ai-assistant/application/create-ai-proposal-draft.use-case.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/domain/ai-extraction.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/domain/model-concept-extractor.js";
export * from "./features/ai-assistant/domain/parts.js";
export * from "./features/ai-assistant/application/plan-wiki-pages.use-case.js";
export * from "./features/ai-assistant/domain/wiki-lint.js";
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
} from "./reader/pdf-source-ladder.js";
export { OpenAccessPdfResolver, type OpenAccessPdfResolverOptions } from "./reader/parts.js";
export { WebDavPdfResolver, type WebDavPdfResolverOptions } from "./reader/parts.js";
export { GitHubRepoPdfResolver, type GitHubRepoPdfResolverOptions } from "./reader/parts.js";
export { type ReaderKeyboardCommand, type ReaderKeyEvent } from "./shared/core-contract.js";
export { READER_ANNOTATION_TYPES, type AnnotationOrigin, type ReaderAnnotationType, type ReaderAnnotation, type NewReaderAnnotation, type ReaderAnnotationPatch, type IReaderAnnotationSource, type IReaderAnnotationSink, type IReaderAnnotationSyncRecorder, type ReaderAnnotationSyncRecord, type IReaderAnnotationProjectSource, type AnnotationSyncState } from "./reader/reader-annotation.js";

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
} from "./reader/pdf-byte-cache.js";
// ink
export { INK_WIDTH_UNITS_PER_MM, INK_PEN_WIDTHS, INK_PEN_WIDTH, INK_HIGHLIGHTER_WIDTH, INK_HIGHLIGHTER_WIDTHS, INK_HIGHLIGHTER_MIN_WIDTH, INK_MIN_WIDTH, INK_MAX_WIDTH, INK_VELOCITY_FULL_TAPER, INK_VELOCITY_TAPER, INK_PRESSURE_MIN_FACTOR, INK_PRESSURE_MAX_FACTOR } from "./ink/parts.js";

export { INK_ZOOM_MIN, INK_ZOOM_MAX, INK_ZOOM_STEP } from "./ink/parts.js";

export { INK_SMOOTH_SPACING, INK_SMOOTH_PASSES, type SmoothedInkStroke } from "./ink/parts.js";

export { INK_TOOLS, INK_COLOURS, INK_MARKER_COLOURS, INK_THEME_COLOURS, INK_PAPERS, INK_SHAPES, INK_HANDS, INK_A4_WIDTH, INK_A4_HEIGHT, INK_COORD_LIMIT, INK_STROKE_MAX_POINTS, INK_PAGE_STROKE_BUDGET, INK_NOTE_MAX_PAGES, INK_PACK_TOLERANCE, INK_PACK_PRESSURE_TOLERANCE, INK_NOTE_TYPE, INK_KEYS, INK_SIDECAR_DIR, INK_CHUNK_EXT, INK_BODY_HEADER, INK_BACKGROUND_ALT, type InkTool, type InkColour, type InkPaper, type InkShape, type InkHand, type InkStroke, type InkLineRecord, type InkPage, type InkNoteMeta, type PackedInkStroke } from "./ink/ink-note.js";

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
} from "./ink/ink-binary.js";

export {
  chunkStrokePoints,
  chunkLineText,
  chunkStroke,
  chunkLine,
  pageFromChunk,
  pageFromChunkBytes,
} from "./ink/ink-chunk-read.js";

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
} from "./ink/recognise.js";

export { INK_ENGINE_MAX_CONFIDENCE, type InkWordReadings } from "./ink/parts.js";
// workspace
export * from "./workspace/workspace-snapshot.js";
export * from "./workspace/fs-port.js";
export * from "./workspace/parts.js";
export * from "./workspace/folder-layout.js";
export * from "./workspace/snapshot-delta.js";
export * from "./workspace/git-port.js";
export * from "./workspace/parts.js";
export * from "./workspace/folder-mirror.js";
export * from "./workspace/parts.js";
export * from "./workspace/git-remote.js";
// search
export * from "./search/search-port.js";
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
