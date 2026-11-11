/**
 * Typed wrappers over the raw wasm exports, folded from 9 one-module files:
 * reader-types, rust-exports-1, rust-exports-2, rust-exports-3, search-acronyms, search-document,
 * search-embedding, search-excerpt-segments, search-settings.
 */
import {
  acronymsForTitle as rawAcronymsForTitle,
  boundedBody as rawBoundedBody,
  excerptOf as rawExcerptOf,
  excerptSegments as rawExcerptSegments,
  normalizeVector as rawNormalizeVector,
  projectSearchDocuments as rawProjectSearchDocuments,
  toAnnotationSearchDocs as rawToAnnotationSearchDocs,
  toPdfSearchDocs as rawToPdfSearchDocs,
  toSearchDocs as rawToSearchDocs,
} from "../pkg/wf_wasm.js";
import type {
  AnchorConfidence,
  AnnotationSource,
  PdfIndexSource as StoredPdfIndexSource,
  PdfPageText as StoredPdfPageText,
  ReaderFitMode,
  SearchDoc,
  TextSpan,
  WikiGraph,
} from "./bindings.js";

export {
  absolutePointTriples,
  accountAttention,
  accountLinks,
  addedNotice,
  annotationDocId,
  appCanonicalUrl,
  appContentTypeFor,
  appendTagHashtags,
  appFileCandidates,
  appHeaders,
  appIsPageRequest,
  arxivEntryToMetadata,
  askPrompt,
  assetExtension,
  assetMimeType,
  axisSpec,
  backlinksForAnnotation,
  bearerToken,
  bothEndsMerge,
  branchRead,
  branchSave,
  buildInkRequest,
  buildLabSnapshotContent,
  buildLocusLink,
  cachePathSegments,
  checkInkChunkBody,
  citationAlertMessage,
  citationAlertTrackFromRow,
  claudeCodeCommands,
  clipSegmentToArea,
  clusterMarks,
  codexToml,
  collectAnnotationImageRegions,
  collectListIds,
  conflictRoute,
  courtesyPauseDue,
  coveredTextSpans,
  createdPageIndex,
  createVectorIndex,
  crossrefToMetadata,
  dashboardAppendCardPair,
  dashboardDefaultLayout,
  dashboardFinalizeLayout,
  dashboardLayoutCacheKey,
  dashboardLayoutSignature,
  dashboardLgNeedsRepair,
  dashboardMergeRglPositions,
  dashboardMergeSupervisorCards,
  dashboardSmNeedsRepack,
  dashboardSyncLayouts,
  daysUntilDate,
  declaredCharset,
  defaultInkNoteMeta,
  defaultShareLinkExpiresAt,
  deletedLocalBase,
  deletedRemoteSides,
  deletionFor,
  describeRemoteStatus,
  describeSync,
  documentIdOf,
  documentIdOfPath,
  editSides,
  effectiveFieldBoosts,
  embeddableText,
  emptyIntegration,
  emptyPageHistory,
  encodeInkChunkBody,
  engineStartParams,
  escapeHtml,
  experimentRowToDomain,
  experimentToRow,
  exportAssetPath,
  exportManifestJson,
  exportReadme,
  extractHeadings,
  extractLexical,
  fenceUntrusted,
  figureLabel,
  findAnnotationBacklinks,
  findDuplicateGroups,
  findTitleMatch,
  fitCols,
  fitsInkNoteBudget,
  flattenOverleafDocs,
  flattenOverleafFiles,
  formatQuoteBlock,
  formatQuoteCiteClipboard,
  frontmatterList,
  frontmatterString,
  geminiInstall,
  gitConnection,
  gitConnectionReady,
  githubCommits,
  githubRepoPdfPath,
  gitlabCommits,
  gitlabLogFilePlan,
  gitReadFailureMessage,
  gitReadPlan,
  gitReason,
  graphTagNames,
  groupByDay,
  groupSubtreeItems,
  highlightWithinExcerpt,
  inboxLinks,
  indexTermsOf,
  inkBoundsContain,
  inkBoundsIntersect,
  inkBoundsOf,
  inkBoundsUnion,
  inkChunkBodySize,
  inkChunkHeaderBytes,
  inkChunkIdOfFileName,
  inkChunkRawThreshold,
  inkChunkShouldTryCompress,
  inkChunkStoresCompressed,
  inkClampBackgroundIndex,
  inkIsPageSource,
  inkIsPdf,
  inkKeptIndices,
  inkPageBounds,
  inkPickCandidates,
  inkPrintDocument,
  inkTrailAlpha,
  isApiHost,
  isBothEndsRpc,
  isConferenceCopy,
  isHtmlContentType,
  isInheritedLinkCode,
  isInkChunkId,
  isInkNoteBody,
  isLegacyTokenHex,
  isLocalZoteroUrl,
  isLoopbackHost,
  isPenBarrelPointer,
  isPenEraserPointer,
  isPlaceholderTitle,
  isPrivateHost,
  isPublicHttpsUrl,
  isSecretName,
  isSyncedTable,
  itemIdsForPapers,
  keyLabel,
  kindMultiplier,
  kindsForResource,
  labelForPath,
  ladderOrder,
  linkCitationMentions,
  linkTargetsError,
  localDbSharedBuffers,
  logEntryMessage,
  logEntryToDomain,
  logEntryToRow,
  logEyebrow,
  mattermostConnection,
  mattermostConnectionReady,
  mattermostPostPlan,
  mattermostPostResponsePlan,
  mattermostTestPosts,
  mayOpenExternally,
  mcpServersJson,
  mergeWikiPages,
  migratedNotice,
  milestoneFromRow,
  milestoneMessage,
  milestoneToRow,
  missingConfigMessage,
  modelBuildBatchRequest,
  modelCacheUrl,
  modelExtractionLimits,
  modelFinalizeExtraction,
  movedIds,
  neutraliseContext,
  newestFirstOrder,
  nextSortOrder,
  normalizeSearchSettings,
  notesTagged,
  noticeFor,
  openAccessSupports,
  openAlexToMetadata,
  originOf,
  pageFromChunkBody,
  pageTextAfterRecognition,
  parseDashboardLayout,
  parsePaperFieldValue,
  pdfDocId,
  pdfDocIdsFor,
  pdfPageHref,
  pdfSourceResolverOrder,
  pickKeeper,
  pinnedScreenIndex,
  planBibliographyAnnotations,
  planChipTarget,
  planItemOrder,
  planPace,
  planTimeline,
  planWikiPages,
  plotHeight,
  plotTier,
  pointInArea,
  postgrestErrorInfo,
  postgrestWritable,
  projectFolderName,
  projectFromRow,
  projectStoredPdfTexts,
  pushFigureStep,
  quoteAwkwardMermaidLabels,
  quoteIdent,
  railGroupText,
  rankFilterOrder,
  readableText,
  readingListItemToDomain,
  readingListItemToRow,
  readingListToDomain,
  readingListToRow,
  readInkChunkHeader,
  readInkNoteBody,
  readInkNoteMeta,
  readInkRequest,
  readsFolder,
  recentFailureIds,
  referenceForDestination,
  relatedConcepts,
  relayPath,
  relayUrl,
  removeHashtagFromBody,
  reorderedIds,
  resourceTypes,
  rowSlots,
  safeLabel,
  safeRelative,
  sameOrigin,
  sameRow,
  screenCachePolicy,
  screenForPath,
  searchRevision,
  semanticScholarTarget,
  semanticScholarToMetadata,
  semanticStatusText,
  settleConflictPlan,
  shortcutLabel,
  shouldPersistIndex,
  sourceNoteTemplateContext,
  splitHeadline,
  splitInkTextLayer,
  splitProposalContent,
  streakDays,
  strokePointTriples,
  subtreeIds,
  syncedTables,
  syncFieldShown,
  syncStrokeSteps,
  tagToHashtag,
  takePageStep,
  texEngineArgs,
  texLogErrors,
  textHash,
  thumbFits,
  thumbKey,
  titleFixes,
  titleForPath,
  titleFromFileName,
  titleKey,
  toZoteroItem,
  trailDiameterPx,
  trimmedOrNone,
  untrustedContextRule,
  uploadErrorSuffix,
  urlMetaReadFailureMessage,
  urlMetaShellTarget,
  urlMetaToMetadata,
  usableStatus,
  vaultRootFromText,
  vaultTooLargeMessage,
  vectorIndexFromBytes,
  vscodeJson,
  webCacheDocumentLimit,
  webdavSupports,
  wikiProposalContent,
  writeInkNoteBody,
  zoteroArxivId,
  zoteroContentKeys,
  zoteroLocalApiOff,
  zoteroLocalStatusMessage,
  zoteroRemoteToInput,
  zoteroRemoteToMetadata,
} from "../pkg/wf_wasm.js";
export type {
  AccountAttention,
  AccountAttentionInput,
  AccountLink,
  AccountLinkId,
  AccountLinksInput,
  AnalysisPdfLink as PdfLink,
  AnchorConfidence,
  AnnotationBacklinkHit,
  AnnotationBacklinkTarget,
  AnnotationInput as RegionAnnotation,
  BackendConfigField,
  BackendConfigFields,
  BibliographyPaperInput,
  BibliographyPaperPlan,
  BibliographyPullInput,
  BibliographyTagSource,
  BranchReadInput,
  BranchSaveInput,
  CitationAlertInput,
  CitationAlertTrack,
  CitationAlertTrackRow,
  CitingPaperInput,
  ClippedSegment,
  ComputeLineInput,
  ConflictInput,
  ConflictRoute,
  ConflictSettlePlan,
  CrossrefMessage,
  DrawArea,
  DuplicateGroup,
  DuplicateReason,
  ErrorInfo,
  Experiment,
  ExperimentRow,
  ExperimentWriteRow,
  ExplorerViewport,
  ExportStats,
  FigureStep,
  GhAuthor,
  GhCommit,
  GhCommitBody,
  GitCommit,
  GitHost,
  GitlabLogFileInput,
  GitlabLogFilePlan,
  GitReadInput,
  GitReadKind,
  GitReadPlan,
  GlCommit,
  GrantIndexEntry,
  InboxInput,
  InboxLink,
  InkPrintDocument,
  InkPrintFigure,
  InkPrintPageSize,
  InkPrintStyleSheet,
  InkPrintUnderlay,
  InkRecognitionLineInput,
  InkRecognitionRequest,
  InkRequestBuildInput,
  Integration as IntegrationInput,
  ItemIdsPlan,
  ItemOrderPlan,
  ItemOrderWrite,
  LabSnapshot,
  LibraryPin,
  LibraryPinIndexRow,
  LiveDocEntry,
  LogDayGroup,
  LogEntryMessageInput,
  LogEntryRow,
  LogEntryWriteRow,
  LogHeadlineSplit,
  MattermostPostInput,
  MattermostPostPlan,
  MattermostPostResponse,
  MattermostPostResponsePlan,
  MattermostTestPost,
  McpLaunchLine,
  MilestoneEvent,
  MilestoneMessageInput,
  MilestoneRowInput,
  MilestoneWriteRow,
  NamedList as GraphNamedList,
  NavRouteInput,
  OpenAlexWork,
  PageDirection,
  PageHistory,
  PageRef,
  PageStep,
  PaperFieldValueData,
  PaperTagRowInput,
  PinnedScreenIndex,
  PinnedScreenIndexInput,
  PinnedSharedByEntry,
  PinRow,
  Point,
  Project,
  ProjectRow,
  ProposalPreview,
  ProposalPreviewItem,
  RailGroupText,
  RailGroupWords,
  ReaderFitMode,
  ReadingListItemRow,
  ReadingListRow,
  ReferenceNotice,
  RemoteStatusInput,
  RowMetrics,
  RowSlot,
  SemanticScholarPaper,
  SemanticStatus,
  ShareIndexRow,
  SourceNoteInput,
  SourceNoteTemplateContext,
  SubtreeListItems,
  TaggedNote as GraphTaggedNote,
  TaggedPaper as GraphTaggedPaper,
  TagPaperLink,
  TagRowInput,
  TakenPageStep,
  TexEngineKind,
  TexErrorRow,
  TextSpan,
  TidyPaper,
  TitleFix,
  TitleLookup,
  UrlMetaResponse,
  VaultPageRow,
  VaultPageWriteRow,
  ZoteroCreator,
  ZoteroExportCreator,
  ZoteroExportItem,
  ZoteroItem,
  ZoteroPaperInput,
} from "./bindings.js";

// --- reader-types ---
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

// --- rust-exports-1 ---
/**
 * Typed Rust exports, folded from 40 one-module re-export files (account-links … library-pins).
 * Values come from wasm-bindgen with `unchecked_*_type` signatures; types from bindings.ts.
 */


// --- rust-exports-2 ---
/**
 * Typed Rust exports, folded from 44 one-module re-export files (local-api-guard … reading-list-rows).
 * Values come from wasm-bindgen with `unchecked_*_type` signatures; types from bindings.ts.
 */


// --- rust-exports-3 ---
/**
 * Typed Rust exports, folded from 40 one-module re-export files (reading-lists-order … zotero-local-url).
 * Values come from wasm-bindgen with `unchecked_*_type` signatures; types from bindings.ts.
 */


// --- search-acronyms ---
/**
 * Title acronym helpers (Rust `search::acronyms`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/search/search-acronyms.ts.
 */
/** Acronyms worth indexing for a title. Usually one; empty for titles that are already short or that would produce something meaningless. */
export function acronymsForTitle(title: string): string[] {
  return rawAcronymsForTitle(title) as string[];
}

// --- search-document ---
/**
 * Search-document projections (Rust `search::search_document`), re-exported from
 * index.ts. Keeps the shape of packages/core/src/search/search-document.ts,
 * pdf-search-document.ts and annotation-search-document.ts; the rules live in Rust.
 * Degree and title maps cross the boundary as plain objects.
 */
/** One PDF page's extracted text. */
export type PdfPageText = Required<StoredPdfPageText>;

/** A paper's extracted PDF text, as callers send it. Rust also accepts a partial one. */
export type PdfIndexSource = Required<Omit<StoredPdfIndexSource, "pages">> & {
  pages: readonly PdfPageText[];
};

function toObject(map: ReadonlyMap<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(map);
}

/** Rust takes adjacency as an array of rows; this converts the TS Map form of the wiki graph. */
function toWireGraph(graph: { nodes: string[]; edges: Map<string, string[]> } | null): WikiGraph | null {
  if (!graph) return null;
  return {
    nodes: [...graph.nodes],
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours: [...neighbours] })),
  };
}

/** Project a workspace snapshot into search documents. */
export function toSearchDocs(
  snapshot: object,
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  return rawToSearchDocs(snapshot, toObject(degrees)) as SearchDoc[];
}

/**
 * A 200-character excerpt of `body` around `terms`, cut like `indexTermsOf`. Throws when the
 * terms together need more than the index cap. Rust `excerpt_of_js`.
 */
export function excerptOf(
  body: string,
  terms: readonly string[],
): { text: string; highlights: { start: number; end: number }[] } {
  const raw = rawExcerptOf(body, terms) as { text: number[]; highlights: { start: number; end: number }[] };
  // Rust sends UTF-16 units so a lone surrogate survives; chunks keep each spread under the argument limit.
  let text = "";
  for (let i = 0; i < raw.text.length; i += 8192) {
    text += String.fromCharCode(...raw.text.slice(i, i + 8192));
  }
  return { text, highlights: raw.highlights };
}

/** Truncate to the indexed body cap without splitting a surrogate pair. */
export function boundedBody(body: string | undefined): string {
  return rawBoundedBody(body ?? "");
}

/** Project extracted PDF page texts into one search document per page. */
export function toPdfSearchDocs(
  sources: readonly PdfIndexSource[],
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  return rawToPdfSearchDocs(sources, toObject(degrees)) as SearchDoc[];
}

/** The worker's build: documents plus per-paper page counts, as `[paperId, pageCount]` pairs. */
/**
 * The search corpus for a snapshot: its own documents, then PDF pages, then reader
 * annotations. `graph` is null when degrees are not wanted. Rust `project_search_documents`.
 */
export function projectSearchDocuments(
  snapshot: object,
  graph: { nodes: string[]; edges: Map<string, string[]> } | null,
  pdfTexts: readonly PdfIndexSource[],
): SearchDoc[] {
  return rawProjectSearchDocuments(snapshot, toWireGraph(graph), pdfTexts) as SearchDoc[];
}

/** Project reader annotations into search documents; titles are the paper's. */
export function toAnnotationSearchDocs(
  annotations: readonly AnnotationSource[],
  paperTitles: ReadonlyMap<string, string>,
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  return rawToAnnotationSearchDocs(
    annotations,
    toObject(paperTitles),
    toObject(degrees),
  ) as SearchDoc[];
}

// --- search-embedding ---
/**
 * Vector normalization (Rust `search::embedding`), re-exported from index.ts.
 * Keeps the signature of packages/core/src/search/embedding-port.ts. Unlike that
 * file, this returns a new Float32Array and does not normalize in place.
 */
/** Unit-normalize a copy, so cosine similarity is a plain dot product. A zero vector comes back as zeros. */
export function normalizeVector(vector: Float32Array): Float32Array {
  return new Float32Array(rawNormalizeVector(vector));
}

// --- search-excerpt-segments ---
/**
 * Excerpt splitting (Rust `excerpt_segments`). Alternating plain and highlighted
 * runs let a renderer mark matches without offset arithmetic or raw HTML.
 */
/** Runs covering the excerpt, with empty runs dropped. Highlight offsets are UTF-16 units. */
export function excerptSegments(excerpt: {
  text: string;
  highlights: readonly { start: number; end: number }[];
}): { text: string; highlighted: boolean }[] {
  return rawExcerptSegments({ text: excerpt.text, highlights: excerpt.highlights });
}

// --- search-settings ---
/**
 * Search settings helpers (Rust `search_settings`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/parts.ts.
 */
/** Weights outside this range stop being a preference and become a bug. */
export const MIN_FIELD_WEIGHT = 0;
export const MAX_FIELD_WEIGHT = 20;

/** Multiplier applied to a downranked kind. Enough to sink, not to hide. */
export const DOWNRANK_FACTOR = 0.25;
