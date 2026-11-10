/**
 * The Rust core, as packages/core sees it. This package cannot import the wasm
 * package, so the app registers the loaded module here (apps/web
 * `lib/rust-core.ts`), and core glue calls Rust through `rust()`.
 *
 * `RustCoreFns` lists only the functions core calls. Add a line when a core
 * file starts calling a new one: the app's `setRustCore(module)` call fails to
 * typecheck if the wasm module does not export it with that signature.
 * Method syntax keeps parameter types bivariant, so the wasm wrappers' narrower
 * role unions still match.
 */
import type { TextLine } from "../features/reader/analysis/line-reconstruction.js";
import type { OutlineTextItem, ReaderOutlineItem } from "../features/reader/outline-types.js";
import type { CoreContract } from "./core-contract.js";
import type { PdfLocus, ResolvedAnchor } from "../reader/anchor-shapes.js";
import type { ExcerptHighlight } from "../features/ai-assistant/domain/ai-types.js";
import type { ExtractionResult } from "../features/ai-assistant/domain/ai-extraction.js";
import type { WikiPagePlan } from "../features/ai-assistant/application/plan-wiki-pages.use-case.js";
import type { FrontmatterValue, ParsedDocument } from "../workspace/frontmatter.js";
import type {
  ChangeSide,
  ConflictKind,
  ExistingEntity,
  ImportAction,
  ImportDiff,
  ParsedEntity,
} from "../workspace/deserialize-workspace.js";
import type { WorkspaceEntityType, WorkspaceProject } from "../workspace/folder-layout.js";
import type { GitVerdict, VaultRepoState } from "../workspace/git-gate.js";
import type { GitFileStatus } from "../workspace/git-port.js";
import type { GitSyncDecision } from "../workspace/git-sync-policy.js";
import type { DeltaPlan, EntityStamp } from "../workspace/snapshot-delta.js";
import type { WorkspaceSnapshot, WorkspaceSnapshotCounts } from "../workspace/workspace-snapshot.js";

/** The note as it stood when the two sides last agreed (Rust `VaultPageBase`). */
export interface VaultPageBase {
  /** A manifest's fields as read: usually an object; an array is kept as read (Rust `Value`). */
  fields: unknown;
  /** Digest, not text: enough to tell a rewrite from an untouched body. */
  bodyDigest: string;
}

/** The folder's files for one project, and the blobs they reference (Rust `SerializedWorkspace`). */
export interface SerializedWorkspace {
  /** Markdown and JSON, keyed by folder-relative path. */
  files: Record<string, string>;
  /** Blobs to fetch: the caller resolves them, the core never does I/O. */
  assets: { storagePath: string; folderPath: string }[];
}

/** The three JSON data files a folder carries (Rust `WorkspaceJsonKind`). */
export type WorkspaceJsonKind = "relations" | "tags" | "reading_list_items";

export const JSON_KINDS: readonly WorkspaceJsonKind[] = ["relations", "tags", "reading_list_items"];

/** A row as the file spells it: an object with an id. */
export interface JsonRow {
  id: string;
  [key: string]: unknown;
}

export interface ParsedJsonData {
  kind: WorkspaceJsonKind;
  path: string;
  rows: JsonRow[];
}

export interface JsonDiffEntry {
  action: ImportAction;
  kind: WorkspaceJsonKind;
  path: string;
  /** The row as the folder has it. Absent on a removal. */
  row?: JsonRow;
  /** The stored row this entry is about: what exists, or what would go. */
  existing: JsonRow;
  /** Why an entry is a conflict, shown before anything is written. */
  reason?: string;
  conflictKind?: ConflictKind;
}

export interface JsonDiff {
  entries: JsonDiffEntry[];
  counts: Record<ImportAction, number>;
}

import type { PaperRef } from "../features/papers/application/metadata-source.js";
import type { HashtagRef } from "../features/papers/domain/paper.js";
import type { ReadingList, ReadingListItem } from "../features/reading-lists/domain/reading-list.js";
import type { ScreeningDecision } from "../features/reading-lists/domain/screening.js";
import type { PaperFieldKind, PaperFieldRollupConfig, PaperFieldValueData } from "../features/papers/domain/paper-field.js";
import type {
  EuropePmcAnswer,
  OpenAccessCandidate,
} from "../features/papers/application/open-access.js";

/** The ink tuning constants the wf-wasm `inkConstants()` returns. */
export interface InkTuningConstants {
  inkWidthUnitsPerMm: number;
  inkPenWidths: readonly number[];
  inkPenWidth: number;
  inkHighlighterWidth: number;
  inkHighlighterWidths: readonly number[];
  inkHighlighterMinWidth: number;
  inkMinWidth: number;
  inkMaxWidth: number;
  inkVelocityFullTaper: number;
  inkVelocityTaper: number;
  inkPressureMinFactor: number;
  inkPressureMaxFactor: number;
  inkZoomMin: number;
  inkZoomMax: number;
  inkZoomStep: number;
  inkSmoothSpacing: number;
  inkSmoothPasses: number;
  inkGroupWindowMs: number;
  inkLineBandRatio: number;
  inkEngineMaxConfidence: number;
  figureAlt: string;
  figureHandles: readonly string[];
}

export interface RustCoreFns {
  /** The `request.jwt.claims` JSON RLS reads; `null` or `""` is `anon` (Rust `db_claims::session_claims`). */
  sessionClaims(userId: string | null): string;
  /** Whether a PDF is over the 200 MiB drop cap (Rust `paper_drop::is_pdf_too_large`). */
  isPdfTooLarge(sizeBytes: number): boolean;
  /** The `arXiv:` stamp in a PDF's first-page text, if any (Rust `paper_drop::arxiv_stamp`). */
  arxivStamp(pageText: string): string | undefined;
  /** Sort key for an annotation: page, then character offset, then distance from the page top. */
  buildAnnotationSortIndex(pageIndex: number, charOffset: number, topPdfUnits: number): string;
  normalizeDoi(doi?: string): string | undefined;
  checkNewPaper(title: string, rating?: number): string;
  projectName(name: string): string | undefined;
  resolveTextAnchor(text: string, locus: PdfLocus): ResolvedAnchor | null;
  highlightWithinExcerpt(excerpt: string, locus: PdfLocus | undefined): ExcerptHighlight | null;
  wikiProposalContent(plan: WikiPagePlan): string;
  planWikiPages(input: {
    extraction: ExtractionResult;
    existingTitles: readonly string[];
    minMentions?: number;
    maxPages?: number;
    titles: Readonly<Record<string, string>>;
  }): WikiPagePlan[];

  creatableRoles(creator: string): string[];
  canCreateRole(creator: string, target: string): boolean;
  validateNewMember(input: {
    email: string;
    password: string;
    fullName?: string | null;
    role: string;
    supervisorId?: string | null;
  }): {
    email: string;
    password: string;
    fullName?: string;
    role: string;
    supervisorId?: string;
  };
  resolveSupervisorId(creatorId: string): string;
  filterTeamMembers<T extends { id: string; supervisorId?: string | null }>(
    viewerId: string,
    members: readonly T[],
    options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
  ): T[];
  filterLabMembers<T extends { id: string; supervisorId?: string | null }>(
    viewerId: string,
    members: readonly T[],
    options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
  ): T[];
  isSupervisorRole(role: string | null | undefined): boolean;
  roleRank(role: string): number | undefined;
  resolveDisplayRole(role: string, opts: { inLab: boolean; ownsOrg?: boolean }): string;
  needsStandaloneRoleSync(
    profile: { role: string; orgSetupComplete?: boolean | null; activeOrgId?: string | null } | null,
    memberships: readonly { orgId?: string; joinSource?: string | null }[],
    inLab: boolean,
  ): boolean;
  isExplicitLabMembership(membership: { orgId?: string; joinSource?: string | null }): boolean;
  hasActiveLab(
    activeOrgId: string | null | undefined,
    memberships: readonly { orgId?: string; joinSource?: string | null }[],
    ownsActiveOrg?: boolean,
  ): boolean;
  // reader
  isRotatedText(transform: readonly number[]): boolean;
  outlineTextLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[];
  bodyFontSize(pages: readonly (readonly OutlineTextItem[])[]): number;
  groupRecurringLines<T>(
    lines: readonly T[],
    textOf: (line: T) => string,
    pageOf: (line: T) => number,
  ): { key: string; pages: Set<number>; members: T[] }[];
  outlineFromText(allPages: readonly (readonly OutlineTextItem[])[]): ReaderOutlineItem[];
  outlineIsPlausible(headings: readonly { page: number }[], pageCount: number): boolean;
  findReferenceSection(
    lines: readonly TextLine[],
    bodyFontSize: number,
    pageCount: number,
    furniture?: readonly boolean[] | null,
  ): { start: number; end: number; headingIndex: number; score: number } | null;
  ladderOrder(supports: readonly boolean[]): number[];
  githubRepoPdfPath(givenPdfPath: string | undefined, paperId: string): string | null;
  openAccessSupports(arxivId: string | null | undefined, url: string | null | undefined, doi: string | null | undefined): boolean;
  webdavSupports(webdavPath: string | undefined): boolean;
  trimmedOrNone(value: string | null | undefined): string | null;
  digestText(text: string): string;
  // json data
  jsonDataPath(projectRoot: string, kind: WorkspaceJsonKind): string;
  jsonKindOfPath(path: string): WorkspaceJsonKind | null;
  isAppOwnedPath(path: string): boolean;
  unstampForCompare(path: string, text: string): string;
  parseJsonData(path: string, content: string, kind: WorkspaceJsonKind): ParsedJsonData | null;
  diffJsonData(
    parsed: ParsedJsonData,
    existing: readonly Readonly<Record<string, unknown>>[],
    options?: { origin?(path: string): ChangeSide },
  ): JsonDiff;
  countJsonActions(entries: readonly JsonDiffEntry[]): Record<ImportAction, number>;
  addCounts(
    a: Readonly<Record<ImportAction, number>>,
    b: Readonly<Record<ImportAction, number>>,
  ): Record<ImportAction, number>;
  // workspace
  toRelativeBlobLinks(
    body: string,
    filePath: string,
  ): { body: string; assets: { scheme: string; storagePath: string; folderPath: string }[] };
  relativeAssetPaths(body: string): { scope: string; path: string }[];
  fromRelativeBlobLinks(body: string, resolved: Readonly<Record<string, string>>): string;
  serializeWorkspace(snapshot: WorkspaceSnapshot, project: WorkspaceProject): SerializedWorkspace;
  workspaceSnapshotCounts(snapshot: WorkspaceSnapshot): WorkspaceSnapshotCounts;
  planDelta(remote: readonly EntityStamp[], held: ReadonlyMap<string, string>): DeltaPlan;
  applyDelta<T extends { id: string }>(
    held: readonly T[],
    fetched: readonly T[],
    order: readonly EntityStamp[],
  ): T[];
  hasConflictMarkers(text: string): boolean;
  vaultPageBase(path: string, content: string): VaultPageBase | null;
  readFrontmatter(content: string): ParsedDocument;
  writeFrontmatter(fields: Record<string, FrontmatterValue | undefined>, body: string): string;
  frontmatterString(frontmatter: Record<string, FrontmatterValue>, key: string): string | undefined;
  frontmatterList(frontmatter: Record<string, FrontmatterValue>, key: string): string[];
  parseWorkspaceFolder(files: Readonly<Record<string, string>>): ParsedEntity[];
  diffWorkspace(
    parsed: readonly ParsedEntity[],
    existing: readonly ExistingEntity[],
    options?: { origin?(path: string): ChangeSide },
  ): ImportDiff;
  // git and sidecar
  describeChanges(status: readonly GitFileStatus[]): string;
  decideVaultCommit(enabled: boolean, state: VaultRepoState): GitVerdict;
  redactSecret(text: string, secret: string | undefined): string;
  decideGitSyncPath(relPath: string, sizeBytes: number, maxFileBytes?: number): GitSyncDecision;
  isUnderIgnoredFolder(relPath: string): boolean;
  entityDir(type: WorkspaceEntityType, projectRoot?: string): string;
  // papers: open access
  resolveArxivId(arxivId: string | null | undefined, doi: string | null | undefined): string | undefined;
  cleanPmcid(id: string | null | undefined): string | undefined;
  knownCandidates(knownPdf: string | null | undefined, page: string | null | undefined): OpenAccessCandidate[];
  pmcCandidates(pmcid: string, license?: string): OpenAccessCandidate[];
  arxivCandidates(arxivId: string): OpenAccessCandidate[];
  parseOpenalex(body: unknown): OpenAccessCandidate[];
  parseUnpaywall(body: unknown): OpenAccessCandidate[];
  parseSemanticScholar(body: unknown): OpenAccessCandidate[];
  parseEuropePmc(body: unknown): EuropePmcAnswer;
  parseBiorxiv(body: unknown, server: string): OpenAccessCandidate[];
  parseDoaj(body: unknown): OpenAccessCandidate[];
  parseZenodo(body: unknown): OpenAccessCandidate[];
  parseHal(body: unknown): OpenAccessCandidate[];
  rankOpenAccessCandidates(candidates: readonly OpenAccessCandidate[]): OpenAccessCandidate[];
  // papers
  titleKey(title?: string | null): string | undefined;
  isPlaceholderTitle(title?: string | null): boolean;
  titleFromFileName(title: string): string;
  parsePaperRef(kind: PaperRef["kind"], value: string): PaperRef;
  normalizeTags(tags: string[]): string[];
  extractHashtagRefs(text?: string): HashtagRef[];
  extractHashtags(text?: string): string[];
  isEmptyPaperSummary(summary: string | null | undefined): boolean;
  isPaperFieldKind(value: string): value is PaperFieldKind;
  encodeRollupOptions(config: PaperFieldRollupConfig): string[];
  parseRollupOptions(options: readonly string[]): PaperFieldRollupConfig | null;
  coercePaperFieldValue(kind: PaperFieldKind, raw: PaperFieldValueData | null | undefined): PaperFieldValueData | null;
  mergeRows(
    base: Record<string, unknown>,
    local: Record<string, unknown>,
    remote: Record<string, unknown>,
  ): { merged: Record<string, unknown>; conflicts: { field: string; base: unknown; local: unknown; remote: unknown }[] };
  sameValue(a: unknown, b: unknown): boolean;
  markdownImage(target: string, alt: string): string;
  imageAltFromFilename(name?: string | null): string;
  imageExtensionForMime(mime: string): string;
  imagePathsInBody(body: string, prefix: string): string[];
  looksLikeImageUrl(url: string): boolean;
  countWords(text: string): number;
  preprintServerFor(doi: string): string | undefined;
  zenodoRecordId(doi: string): string | undefined;
  normalizeFieldName(raw: string): string;
  normalizeSelectOptions(raw: readonly string[]): string[];
  primaryPaperRef(arxivId: string | null | undefined, doi: string | null | undefined): PaperRef | null;
  appendPaperNote(existing: string | undefined, addition: string): string | undefined;
  defaultShareLinkExpiresAt(nowMs: number): string;
  // sharing constants (wf-core SHAREABLE_TYPES, CRDT_EDITABLE_SHARE_TYPES, SHARE_LINK_DEFAULT_TTL_DAYS)
  shareableTypes(): readonly string[];
  crdtEditableShareTypes(): readonly string[];
  shareLinkDefaultTtlDays(): number;
  // vault page constants (wf-core vault::page VAULT_IMAGE_PREFIX, VAULT_BODY_PREVIEW_CHARS)
  vaultImagePrefix(): string;
  vaultBodyPreviewChars(): number;
  // CRDT compaction guard (wf-core collab::compact_skip_reason)
  compactSkipReason(snapshotUptoId: number, currentSnapshotUpto?: number): "nothing-to-do" | "stale" | undefined;
  imagesOf(metadata: Record<string, unknown> | null | undefined): string[];
  proposalApplies(storedUpdatedAt: string | null | undefined, expectedRevision?: string | null): boolean;
  hasText(text: string | null | undefined): boolean;
  selectModelProvider(providers: readonly { provider: string; available: boolean }[], selected: string): string;
  pinnedScreenIndex(input: {
    resourceType: string;
    ownedIds: string[];
    pins: { resourceType: string; resourceId: string; ownerId: string; userId: string }[];
    shares: { resourceType: string; resourceId: string | null; ownerId: string; access: string }[];
  }): {
    extraIds: string[];
    pinnedSharedBy: { resourceId: string; ownerId: string }[];
    canComment: { resourceId: string; granted: boolean }[];
    canEdit: { resourceId: string; granted: boolean }[];
  };
  // net (desktop main process)
  isPrivateHost(hostname: string): boolean;
  isPublicHttpsUrl(raw: string): boolean;
  modelCacheUrl(url: string, appHost: string): string | null;
  cachePathSegments(url: string): string[] | null;
  isApiHost(url: string): boolean;
  mayOpenExternally(url: string): boolean;
  // citation alerts
  /** The candidate's citation-intent label, or null; the wasm side reads its CitationSignals fields. */
  citationIntentLabel(candidate: object): string | null;
  mergeSeenIds(prior: readonly string[], currentIds: readonly string[]): string[];
  // sidecar (MCP config, home config)
  isElectronMcpEntry(entry: unknown): boolean;
  mcpFileOf(env: unknown): string;
  rewriteMcpConfig(
    config: unknown,
    key: "mcpServers" | "servers",
    launch: { command: string; args: string[]; env: Record<string, string> },
  ): { changed: boolean; config: unknown };
  vaultRootFromText(text: string): string | null;
  /** The checked ink recognition request, or null; the desktop narrows it to its own type. */
  readInkRequest(request: unknown): unknown;
  /** The helper's request for a page: strokes flattened to x, y, pressure triples. */
  buildInkRequest(input: unknown): unknown;
  listMembershipByKey(lists: readonly { id: string }[], items: readonly { listId: string; paperId?: string | null; vaultPageId?: string | null }[], key: "paper" | "vaultPage" | "either"): Map<string, Set<string>>;
  /** The vault-relative path, or throws the refusal message. */
  safeRelative(candidate: string): string;
  isLocalZoteroUrl(url: string): boolean;
  formatLogLine(entry: { at: string; level: string; source: string; message: string; detail?: string }): string;
  /** The writes for a new item order, or the message that refuses it. */
  planItemOrder(listId: string, items: readonly ReadingListItem[], orderedIds: readonly string[]): { error?: string | null; writes: { itemId: string; sortOrder: number }[] };
  /** The item id of each paper in order, or the message that refuses it. */
  itemIdsForPapers(listId: string, items: readonly ReadingListItem[], paperIds: readonly string[]): { error?: string | null; itemIds: string[] };
  /** The sort order a new row gets after `siblings`: 0 when empty, else one past the highest. */
  nextSortOrder(siblings: readonly ReadingListItem[]): number;
  /** Whether a database error code means only the inherited link failed. */
  isInheritedLinkCode(code: string | null | undefined): boolean;
  /** Whether an image of this MIME type and byte size is stored as it came. */
  canStoreUnchanged(mime: string, sizeBytes: number): boolean;
  /** Whether `message` names a browser network failure ("Failed to fetch" and kin). */
  isNetworkFailure(message: string): boolean;
  /** The sync line's Zotero write-back part for a summary, or "" when nothing was owed. */
  zoteroWriteBackMessage(
    summary: { created: number; updated: number; conflicts: number; failed: number; firstError?: string } | null,
  ): string;
  /** `listId` and every list below it, deepest first. */
  deepestFirstListIds(listId: string, lists: readonly ReadingList[]): string[];
  /** Distinct reviewers of the decisions. */
  reviewers(decisions: readonly ScreeningDecision[]): string[];
  gitReason(text: string): string;
  /** Base64 of `username:token`; an absent username is `x-access-token`. */
  gitBasicAuth(token: string, username?: string): string;
  /** Git flags and env overrides for one remote command; `env` is merged over `process.env`. */
  gitRemoteAuth(input: { url: string; token?: string; username?: string }): {
    flags: string[];
    env: Record<string, string>;
  };
  /** `git status --porcelain -z` entries reduced to deleted, added or modified. */
  gitParseStatus(stdout: string): { path: string; state: "deleted" | "added" | "modified" }[];
  /** `git log` commits from the unit-separator field format. */
  gitParseLog(stdout: string): { oid: string; authoredAt: string; author: string; message: string }[];
  /** Paths under a "would be overwritten" git message. */
  gitOverwrittenFiles(output: string): string[];
  /** Non-empty entries of a NUL-separated git listing. */
  gitNulList(stdout: string): string[];
  /** Path batches for one command line each; `maxUnits` defaults to 8000 UTF-16 units. */
  gitPathChunks(paths: readonly string[], maxUnits?: number): string[][];
  /** The "too large to open here" text for a byte cap. */
  vaultTooLargeMessage(capBytes: number): string;
  /** Sidecar argv (without the program name): the parsed plan with raw paths, or the message to print. */
  parseSidecarArgs(argv: readonly string[]): (
    | {
        kind: "ok";
        dataDir: string;
        migrations: string[];
        backupsDir: string;
        migrateFrom: string | null;
        artifacts: string | null;
        bridge: string | null;
        appVersion: string | null;
        homeVariant: string | null;
        noLocalApi: boolean;
      }
    | { kind: "error"; message: string }
  );
  migratedNotice(raw: string | null): string | null;
  /** Index of the matching project; throws when none or several match. */
  pickProject(projects: readonly { id?: string; name: string; dir: string }[], needle: string | null): number;
  /** `defaults` with the local database's `-c shared_buffers=...` flags appended. */
  engineStartParams(defaults: readonly string[]): string[];
  // ink binary (wf-core ink::chunk)
  inkChunkRawThreshold(): number;
  inkChunkShouldTryCompress(bodyLen: number): boolean;
  inkChunkStoresCompressed(bodyLen: number, packedLen: number): boolean;
  /** One stroke's `x, y, pressure` triples, absolute and unwrapped (wf-core `chunk_read`). */
  strokePointTriples(body: Uint8Array, strokeIndex: number): Float64Array;
  /** Every point as `Int16` `x, y, pressure` triples, wrapped as an `Int16Array` write wraps (wf-core `chunk_read`). */
  absolutePointTriples(body: Uint8Array): Int16Array;
  // ink hit test and page buffer (wf-core ink::hit_test, ink::page_buffer)
  inkStrokeNearSegment(xs: Float32Array, ys: Float32Array, fx: number, fy: number, tx: number, ty: number, radius: number): boolean;
  inkLassoKeeps(xs: Float32Array, ys: Float32Array, polygon: Float64Array): boolean;
  inkBoundsOf(xs: Float32Array, ys: Float32Array): Float64Array;
  inkBoundsIntersect(a: Float64Array, b: Float64Array, slack: number): boolean;
  inkBoundsUnion(a: Float64Array, b: Float64Array): Float64Array;
  inkBoundsContain(bounds: Float64Array, x: number, y: number, slack: number): boolean;
  inkPageBounds(boxes: Float64Array, live: Uint8Array): Float64Array;
  inkKeptIndices(alive: Uint8Array): Uint32Array;
  inkClampBackgroundIndex(index: number): number;
  // ink recognition (wf-core ink::ink_engine, ink::recognise); the engine choice stays in TS
  isInkEngineId(id: string): boolean;
  inkEngineInfo<I>(id: string): I | null;
  inkEngineRank(id: string): number;
  inkUnsureConfidence(): number;
  isUnsureLine(line: { conf: number }): boolean;
  mapInkConfidence(raw: number, scale?: number): number;
  inkPageConfidence(lines: readonly { conf: number }[]): number;
  inkVocabularyHints(sources: readonly (readonly string[])[], limit?: number): string[];
  bandsCoincide(a: readonly [number, number], b: readonly [number, number]): boolean;
  inkPageSummary(lines: readonly { text: string; conf: number }[]): { text: string; confidence: number; unsure: number };
  /** The ink tuning constants (wf-core width, zoom, smooth, segment, decode, figure); read at call time, never at module load. */
  inkConstants(): InkTuningConstants;
  // Lexical and model extraction: typed by LexicalConceptFns and ModelExtractionFns in core-contract.ts.
  extractLexical: unknown;
  modelExtractionLimits: unknown;
  modelBuildBatchRequest: unknown;
  modelFinalizeExtraction: unknown;
  // sidecar wire and app:// protocol (wf-core wire, app_protocol); sockets, timers and handlers stay in TS
  wireRoute(line: string, acceptAnswers: boolean): { kind: "skip" | "reply" | "call" | "settle" | "badAnswer"; [key: string]: unknown };
  wireParseRequest(line: string): { ok: boolean; [key: string]: unknown };
  wireTag(value: unknown): { kind: "bigint" | "bytes"; [key: string]: unknown } | null;
  wireErrorReply(id: number | null, error: string): Record<string, unknown>;
  wireOkReplyHead(id: number): { id: number; ok: true };
  appFileCandidates(root: string, requestUrl: string, sep: string): string[] | null;
  appCanonicalUrl(requestUrl: string): string | null;
  appIsPageRequest(requestUrl: string): boolean;
  appHeaders(contentType: string): Record<string, string>;
  appContentTypeFor(file: string): string;
  // AI session start, proposal shaping, folder drafts and Overleaf status (wf-core ai, overleaf); typed in core-contract.ts or the use-case shells.
  startAiSession: unknown;
  shapeAiProposalDraft: unknown;
  isFolderDraftPath: unknown;
  folderDraftForProject: unknown;
  describeOverleafStatus: unknown;
  parseStoredAiProvider: unknown;
  homeConfigPath: unknown;
  mcpClientConfigs: unknown;
  sameOrigin: unknown;
  originOf: unknown;
  searchMatches: unknown;
  isSearchFile: unknown;
  isSkippedDir: unknown;
  rootVerdict: unknown;
  chooseRoot: unknown;
  temporaryName: unknown;
  isTemporaryName: unknown;
  isLoopbackHost(host: string | undefined, port: number): boolean;
  bearerToken(header: string | undefined): string | undefined;
  isLegacyTokenHex(stored: string): boolean;
  isSecretName(name: string): boolean;
  projectFolderName(dir: string): string | undefined;
}

let core: RustCoreFns | null = null;

export function setRustCore(module: RustCoreFns): void {
  core = module;
}

export function rust(): RustCoreFns & CoreContract {
  if (!core) throw new Error("Rust core not registered yet: the app calls setRustCore() after loading it");
  return core as RustCoreFns & CoreContract;
}
