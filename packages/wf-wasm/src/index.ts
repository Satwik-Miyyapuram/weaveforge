/**
 * The Rust core (crates/wf-wasm) for TypeScript.
 *
 * wasm-bindgen's raw exports return `any`. Each is re-exported here with the
 * type that crates/wf-bindings generated from the Rust struct into
 * ./bindings.ts. These modules declare no types of their own, and every raw
 * export has a wrapper here or in a sibling module (ink.ts); test/index.test.ts
 * checks both.
 *
 * The `as` in each wrapper is unchecked, so every wrapper needs a test that
 * checks the runtime value against its type, like the `coreInfo` one.
 *
 * Call `init` (browser, fetches the .wasm) or `initSync` (bytes in hand, e.g.
 * Node) once before any other export.
 */
import init, {
  initSync,
  coreInfo as rawCoreInfo,
  maxIndexTextUtf16 as rawMaxIndexTextUtf16,
  tokenize as rawTokenize,
  indexTerms as rawIndexTerms,
  parseQuery as rawParseQuery,
  maxFusionIds as rawMaxFusionIds,
  fuseRankings as rawFuseRankings,
  buildExcerpt as rawBuildExcerpt,
  changedSide as rawChangedSide,
  isUnderIgnoredFolder as rawIsUnderIgnoredFolder,
  decideGitSyncPath as rawDecideGitSyncPath,
  decideVaultCommit as rawDecideVaultCommit,
  redactSecret as rawRedactSecret,
  describeChanges as rawDescribeChanges,
  describePull as rawDescribePull,
  describePush as rawDescribePush,
  stampWorkspaceId as rawStampWorkspaceId,
  planDelta as rawPlanDelta,
  applyDelta as rawApplyDelta,
  safeWorkspacePath as rawSafeWorkspacePath,
  isSafeWorkspacePath as rawIsSafeWorkspacePath,
  parsePaperRef as rawParsePaperRef,
  normalizeArxivId as rawNormalizeArxivId,
  extractDoi as rawExtractDoi,
  extractPageMetadata as rawExtractPageMetadata,
  pageImportRefusal as rawPageImportRefusal,
  guessBlobContentType as rawGuessBlobContentType,
  mergeVaultPage as rawMergeVaultPage,
  vaultPageBase as rawVaultPageBase,
  vaultPageSide as rawVaultPageSide,
  mergeHunks as rawMergeHunks,
  writeConflictMarkers as rawWriteConflictMarkers,
  readFrontmatter as rawReadFrontmatter,
  writeFrontmatter as rawWriteFrontmatter,
  mergeRows as rawMergeRows,
  sameValue as rawSameValue,
  diffBody as rawDiffBody,
  hasConflictMarkers as rawHasConflictMarkers,
  markdownImage as rawMarkdownImage,
  imageAltFromFilename as rawImageAltFromFilename,
  imageExtensionForMime as rawImageExtensionForMime,
  imagePathsInBody as rawImagePathsInBody,
  normalizeMarkdownImageSyntax as rawNormalizeMarkdownImageSyntax,
  toRelativeBlobLinks as rawToRelativeBlobLinks,
  relativeAssetPaths as rawRelativeAssetPaths,
  fromRelativeBlobLinks as rawFromRelativeBlobLinks,
  projectDir as rawProjectDir,
  entityDir as rawEntityDir,
  projectMetaDir as rawProjectMetaDir,
  idSuffix as rawIdSuffix,
  stripKindSuffix as rawStripKindSuffix,
  jsonKindOfPath as rawJsonKindOfPath,
  isAppOwnedPath as rawIsAppOwnedPath,
  serializeWorkspace as rawSerializeWorkspace,
  workspaceSnapshotCounts as rawWorkspaceSnapshotCounts,
  parseWorkspaceFolder as rawParseWorkspaceFolder,
  diffWorkspace as rawDiffWorkspace,
  jsonDataPath as rawJsonDataPath,
  parseJsonData as rawParseJsonData,
  diffJsonData as rawDiffJsonData,
  countJsonActions as rawCountJsonActions,
  countWords as rawCountWords,
  tagTone as rawTagTone,
  headingSlug as rawHeadingSlug,
  stripUnresolvedImageRefs as rawStripUnresolvedImageRefs,
  parseMdImageAlt as rawParseMdImageAlt,
  withMdImageAlt as rawWithMdImageAlt,
  withImageWidth as rawWithImageWidth,
  setImagePlacement as rawSetImagePlacement,
  sortHitOrder as rawSortHitOrder,
  isPreviewKey as rawIsPreviewKey,
  groupPaletteRows as rawGroupPaletteRows,
  matchingPageIndices as rawMatchingPageIndices,
  commandMatchIndices as rawCommandMatchIndices,
  paletteModeFor as rawPaletteModeFor,
  invalidationPlan as rawInvalidationPlan,
  isKnownResourceType as rawIsKnownResourceType,
  invalidationMap as rawInvalidationMap,
  cardSnippet as rawCardSnippet,
  addCounts as rawAddCounts,
  planMirror as rawPlanMirror,
  cleanPastedText as rawCleanPastedText,
  pasteLandsInVerbatimContext as rawPasteLandsInVerbatimContext,
  cleanWrappedText as rawCleanWrappedText,
  cleanPdfText as rawCleanPdfText,
  applyCommaPlacement as rawApplyCommaPlacement,
  tabSeparatedToMarkdownTable as rawTabSeparatedToMarkdownTable,
  cleanUrlsWithRules as rawCleanUrlsWithRules,
  defaultPasteSettings as rawDefaultPasteSettings,
  normalizePasteSettings as rawNormalizePasteSettings,
  parseLinkRemovalText as rawParseLinkRemovalText,
} from "../pkg/wf_wasm.js";
import type {
  ActionCounts,
  BlobAsset,
  BlobScheme,
  BodyDiff,
  BodySides,
  Bullets,
  ChangeSide,
  CleanPasteResult,
  CommaPlacement,
  Conflict,
  ConflictKind,
  CoreInfo,
  DiffHunk,
  DiffLine,
  DiffOp,
  ExcerptRange,
  ExistingEntity,
  GitPullResult,
  GitPushResult,
  GitSyncSkipReason,
  HunkPick,
  ImportAction,
  ImportDiff,
  ImportDiffEntry,
  ImportMergeDetail,
  InkHand,
  InkNoteMeta,
  InkPaper,
  JsonDiff,
  JsonDiffEntry,
  MergeFieldDispute,
  MergeResult,
  MirrorResult,
  PageMetadata,
  PaperRef,
  PaperRefKind,
  ParsedDocument,
  ParsedEntity,
  ParsedJsonData,
  ParsedQuery,
  PasteSettings,
  PdfTextOptions,
  RankedList,
  Rejoin,
  RelativeAsset,
  RelativeLinks,
  SearchKind,
  SerializedAsset,
  SerializedWorkspace,
  TextResult,
  TokenizerOptions,
  UrlCleanupResult,
  VaultPageBase,
  VaultPageMerge,
  VaultPageSide,
  WorkspaceEntityType,
  WorkspaceJsonKind,
  WorkspaceSnapshotCounts,
  WrappedTextOptions,
  PackedInkStroke,
  InkStrokePackerOptions,
  MdAlign,
  MdImageAlt,
  MdPlacement,
  ImagePlacementPatch,
  GroupedRows,
  HitKey,
  HitSort,
  PaletteGroup,
  PaletteKey,
  PaletteMode,
  ResourceType,
  InvalidationPlan,
  InvalidationEntry,
} from "./bindings.js";

// RankedList stays internal: its generated `weight` allows null, which Rust rejects.
export type {
  PackedInkStroke,
  InkStrokePackerOptions,
  GroupedRows,
  HitKey,
  HitSort,
  PaletteGroup,
  PaletteKey,
  PaletteMode,
  ResourceType,
  InvalidationPlan,
  InvalidationEntry,
  MdAlign,
  MdImageAlt,
  MdPlacement,
  ImagePlacementPatch,
  ActionCounts,
  BlobAsset,
  BlobScheme,
  BodyDiff,
  BodySides,
  Bullets,
  ChangeSide,
  CleanPasteResult,
  CommaPlacement,
  Conflict,
  ConflictKind,
  CoreInfo,
  DiffHunk,
  DiffLine,
  DiffOp,
  ExcerptRange,
  ExistingEntity,
  GitPullResult,
  GitPushResult,
  GitSyncSkipReason,
  HunkPick,
  ImportAction,
  ImportDiff,
  ImportDiffEntry,
  ImportMergeDetail,
  InkHand,
  InkNoteMeta,
  InkPaper,
  JsonDiff,
  JsonDiffEntry,
  MergeFieldDispute,
  MergeResult as FieldMergeResult,
  MirrorResult,
  PageMetadata,
  PaperRef,
  PaperRefKind,
  ParsedDocument,
  ParsedEntity,
  ParsedJsonData,
  ParsedQuery,
  PasteSettings,
  PdfTextOptions,
  Rejoin,
  RelativeAsset,
  RelativeLinks,
  SearchKind,
  SerializedAsset,
  SerializedWorkspace,
  TextResult,
  TokenizerOptions,
  UrlCleanupResult,
  VaultPageBase,
  VaultPageMerge,
  VaultPageSide,
  WorkspaceEntityType,
  WorkspaceJsonKind,
  WorkspaceSnapshotCounts,
  WrappedTextOptions,
};
export { init, initSync };
export * from "./ink.js";
export * from "./ink-lines.js";
export * from "./ink-note.js";
export * from "./reader-anchor.js";
export * from "./reader-annotation.js";
export * from "./reader-ink-stroke.js";
export * from "./reader-locate.js";
export * from "./reader-analysis-lines.js";
export * from "./reader-analysis-text.js";
export * from "./reader-locus.js";
export * from "./reader-selection.js";
export * from "./reader-viewport.js";
export * from "./reader-zotero-sync.js";
export * from "./reader-analysis-bibliography.js";
export * from "./reader-analysis-citations.js";
export * from "./reader-analysis-document.js";
export * from "./reader-analysis-outline.js";
export * from "./reader-analysis-structure.js";
export * from "./reader-pdf-source-ladder.js";
export * from "./papers-bib-import.js";
export * from "./papers-field-value.js";
export * from "./papers-compute-rollup.js";
export * from "./papers-library-tidy.js";
export * from "./papers-merge.js";
export * from "./papers-open-access.js";
export * from "./papers-paper-title.js";
export * from "./papers-records.js";
export * from "./papers-zotero-mapping.js";
export * from "./papers-metadata-mapping.js";
export * from "./report-bib-entries.js";
export * from "./report-cite-key.js";
export * from "./report-markdown-to-latex.js";
export * from "./report-records.js";
export * from "./screening-records.js";
export * from "./graph-settings.js";
export * from "./vault-page.js";
export * from "./experiment-status.js";
export * from "./projects.js";
export * from "./lab-snapshot.js";
export * from "./untrusted-context.js";
export * from "./wiki-index.js";
export * from "./dashboard-layout.js";
export * from "./theme-config.js";
export * from "./user-appearance.js";
export * from "./ai-access-policy.js";
export * from "./log-entry.js";
export * from "./milestone.js";
export * from "./org.js";
export * from "./paper-relation.js";
export * from "./reader-ink-undo.js";
export * from "./reading-list.js";
export * from "./search-acronyms.js";
export * from "./search-related.js";
export * from "./search-settings.js";
export * from "./sharing.js";
export * from "./ai-mcp-result.js";
export * from "./hybrid-fusion.js";
export * from "./personalized-pagerank.js";
export * from "./reader-link-citations.js";
export * from "./search-tuning.js";
export * from "./search-history.js";
export * from "./search-retry.js";
export * from "./search-embedding.js";
export * from "./text-chunks.js";
export * from "./url-safety.js";
export * from "./user-integration-credentials.js";
export * from "./wiki-graph.js";
export * from "./wiki-merge.js";
export * from "./user-settings.js";


/** Facts about this core build, such as its version. */
export function coreInfo(): CoreInfo {
  return rawCoreInfo() as CoreInfo;
}

/** Largest text, in UTF-16 units, that `tokenize`, `indexTerms` and `parseQuery` accept (Rust `MAX_INDEX_TEXT_UTF16`). */
export function maxIndexTextUtf16(): number {
  return rawMaxIndexTextUtf16();
}

/** Throws before the text is copied into WASM, which would grow linear memory for good. */
function checkIndexText(text: string): void {
  const max = rawMaxIndexTextUtf16();
  if (text.length > max) {
    throw new RangeError(`text is ${text.length} UTF-16 units; MAX_INDEX_TEXT_UTF16 is ${max}`);
  }
}

/** Search terms of `text`, deduplicated, first occurrence wins. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function tokenize(text: string, options: TokenizerOptions): string[] {
  checkIndexText(text);
  return rawTokenize(text, options) as string[];
}

/** `tokenize` then `processTerm` on each token: what MiniSearch indexes. Not deduplicated. */
export function indexTerms(text: string, options: TokenizerOptions): string[] {
  checkIndexText(text);
  return rawIndexTerms(text, options) as string[];
}

/** The query split into terms, phrases, exclusions and filters. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function parseQuery(query: string): ParsedQuery {
  checkIndexText(query);
  return rawParseQuery(query) as ParsedQuery;
}

/**
 * A snippet of `body` around the densest cluster of `terms`, like `buildExcerpt`
 * in @weaveforge/core. Offsets are UTF-16 units into `text`.
 */
export function buildExcerpt(
  body: string,
  terms: readonly string[],
  options: { maxChars?: number; singleLine?: boolean } = {},
): { text: string; highlights: ExcerptRange[] } {
  checkIndexText(body);
  const max = rawMaxIndexTextUtf16();
  // Each term counts its length + 1, so many empty terms are capped too.
  const total = terms.reduce((sum, term) => sum + term.length + 1, 0);
  if (total > max) {
    throw new RangeError(`terms need ${total} UTF-16 units (length + 1 each); MAX_INDEX_TEXT_UTF16 is ${max}`);
  }
  checkU32("maxChars", options.maxChars);
  const raw = rawBuildExcerpt(body, terms, options.maxChars, options.singleLine) as {
    text: number[];
    highlights: ExcerptRange[];
  };
  // Chunks keep each spread under the engine's argument limit.
  let text = "";
  for (let i = 0; i < raw.text.length; i += 8192) {
    text += String.fromCharCode(...raw.text.slice(i, i + 8192));
  }
  return { text, highlights: raw.highlights };
}

/** Most ids all lists together may pass to `fuseRankings` (Rust `MAX_FUSION_IDS`). */
export function maxFusionIds(): number {
  return rawMaxFusionIds();
}

/** Throws unless `value` is undefined or an integer in 0..=2^32-1. */
function checkU32(name: string, value: number | undefined): void {
  if (value !== undefined && !(Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff)) {
    throw new RangeError(`${name} must be an integer in 0..=4294967295, got ${value}`);
  }
}

/**
 * Reciprocal rank fusion, like `fuseRankings` in @weaveforge/core: `identify`
 * gives the key the lists agree on, and the first list an id appears in
 * supplies its item. Ties break on code point order of the id (the TS used
 * localeCompare). `limit` 0 or undefined means no limit.
 */
export function fuseRankings<T>(
  lists: readonly { items: readonly T[]; weight?: number }[],
  identify: (item: T) => string,
  options: { k?: number; limit?: number } = {},
): T[] {
  checkU32("k", options.k);
  checkU32("limit", options.limit);
  const max = rawMaxFusionIds();
  const total = lists.reduce((sum, list) => sum + list.items.length, 0);
  if (total > max) {
    throw new RangeError(`lists have ${total} ids in total; MAX_FUSION_IDS is ${max}`);
  }
  const representative = new Map<string, T>();
  const ranked: RankedList[] = lists.map((list) => {
    const ids = list.items.map((item) => {
      const id = identify(item);
      if (!representative.has(id)) representative.set(id, item);
      return id;
    });
    return { ids, weight: list.weight ?? 1 };
  });
  const limit = options.limit === 0 ? undefined : options.limit;
  const fused = rawFuseRankings(ranked, options.k, limit) as string[];
  return fused.map((id) => representative.get(id) as T);
}

/** Largest file `decideGitSyncPath` admits by default (TS `GIT_SYNC_LIMITS.maxFileBytes`). */
export const GIT_SYNC_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Which side changed a mirrored file since both last agreed. */
export function changedSide(origin: { base?: string; folder?: string; workspace?: string }): ChangeSide {
  return rawChangedSide(origin.base, origin.folder, origin.workspace) as ChangeSide;
}

/** True when the path sits inside a folder git sync never touches. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function isUnderIgnoredFolder(relPath: string): boolean {
  checkIndexText(relPath);
  return rawIsUnderIgnoredFolder(relPath);
}

/** Whether one workspace path goes into git, and why not. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function decideGitSyncPath(
  relPath: string,
  sizeBytes: number,
  maxFileBytes: number = GIT_SYNC_MAX_FILE_BYTES,
): { include: true } | { include: false; reason: GitSyncSkipReason } {
  checkIndexText(relPath);
  return rawDecideGitSyncPath(relPath, sizeBytes, maxFileBytes) as
    | { include: true }
    | { include: false; reason: GitSyncSkipReason };
}

/**
 * Whether the folder may be committed to, and why not. Off unless `enabled`; refused inside a
 * foreign repository. `state` and the verdict have the shapes of core's git-gate.ts.
 */
export function decideVaultCommit(
  enabled: boolean,
  state: { kind: "none" } | { kind: "own" } | { kind: "enclosing"; root: string },
): { ok: true; action: "init" | "commit" } | { ok: false; reason: string } {
  return rawDecideVaultCommit(enabled, state) as
    | { ok: true; action: "init" | "commit" }
    | { ok: false; reason: string };
}

/** `text` with every occurrence of `secret` replaced. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function redactSecret(text: string, secret: string | undefined): string {
  checkIndexText(text);
  if (secret !== undefined) checkIndexText(secret);
  return rawRedactSecret(text, secret);
}

/** A commit message for the changes: "N added, N changed, N removed", or "No changes". */
export function describeChanges(status: readonly { state: "added" | "modified" | "deleted" }[]): string {
  return rawDescribeChanges(status);
}

/** One line for the Settings panel. */
export function describePull(result: GitPullResult): string {
  return rawDescribePull(result);
}

/** One line for the Settings panel. */
export function describePush(result: GitPushResult): string {
  return rawDescribePush(result);
}

/** The file with a `weaveforge-id` frontmatter line added, or null if it already has one. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function stampWorkspaceId(content: string, id: string): string | null {
  checkIndexText(content);
  checkIndexText(id);
  return rawStampWorkspaceId(content, id) ?? null;
}

/**
 * What to fetch and what to forget. `remote` is the database's `{ id, updatedAt }` listing;
 * `held` maps each held id to its stamp.
 */
export function planDelta(
  remote: readonly { id: string; updatedAt: string }[],
  held: ReadonlyMap<string, string>,
): { fetch: string[]; drop: string[]; unchanged: boolean } {
  return rawPlanDelta(remote, [...held.entries()]) as { fetch: string[]; drop: string[]; unchanged: boolean };
}

/** The held rows and fetched rows merged, in the order `order` gives. Rows are matched by `id`. */
export function applyDelta<T extends { id: string }>(
  held: readonly T[],
  fetched: readonly T[],
  order: readonly { id: string; updatedAt: string }[],
): T[] {
  return rawApplyDelta(held, fetched, order) as T[];
}

/** The normalized relative path; throws `Unsafe workspace path: <path>` for one that could leave the root. */
export function safeWorkspacePath(path: string): string {
  checkIndexText(path);
  return rawSafeWorkspacePath(path);
}

/** True when `safeWorkspacePath` accepts the path. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function isSafeWorkspacePath(path: string): boolean {
  checkIndexText(path);
  return rawIsSafeWorkspacePath(path);
}

/** The paper id a `kind` reference points to, normalized (Rust `parse_paper_ref`). Throws over MAX_INDEX_TEXT_UTF16 units. */
export function parsePaperRef(kind: PaperRefKind, value: string): PaperRef {
  checkIndexText(value);
  return rawParsePaperRef(kind, value) as PaperRef;
}

/** The bare arXiv id in `value` (a URL or `arXiv:` prefix), or undefined. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function normalizeArxivId(value?: string): string | undefined {
  if (!value) return undefined;
  checkIndexText(value);
  return rawNormalizeArxivId(value) ?? undefined;
}

/** The DOI in `value`, or undefined. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function extractDoi(value?: string): string | undefined {
  if (!value) return undefined;
  checkIndexText(value);
  return rawExtractDoi(value) ?? undefined;
}

/** Citation metadata read from a page's HTML. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function extractPageMetadata(html: string, url: string): PageMetadata {
  checkIndexText(html);
  checkIndexText(url);
  return rawExtractPageMetadata(html, url) as PageMetadata;
}

/** Why `meta` cannot be imported as a paper, or null if it can. */
export function pageImportRefusal(meta: PageMetadata): string | null {
  return rawPageImportRefusal(meta) ?? null;
}

/** MIME type for a blob's file `path`, by extension. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function guessBlobContentType(path: string): string {
  checkIndexText(path);
  return rawGuessBlobContentType(path);
}

/** Three-way merge of a note's frontmatter fields and body (Rust `merge_vault_page`). */
export function mergeVaultPage(
  base: { fields: Readonly<Record<string, unknown>>; bodyDigest: string },
  folder: { fields: Readonly<Record<string, unknown>>; body: string },
  workspace: { fields: Readonly<Record<string, unknown>>; body: string },
): VaultPageMerge {
  checkIndexText(base.bodyDigest);
  checkIndexText(folder.body);
  checkIndexText(workspace.body);
  return rawMergeVaultPage(base, folder, workspace) as VaultPageMerge;
}

/** The base a mirrored note leaves behind, or null if the file is not a note. */
export function vaultPageBase(path: string, content: string): VaultPageBase | null {
  checkIndexText(path);
  checkIndexText(content);
  return (rawVaultPageBase(path, content) ?? null) as VaultPageBase | null;
}

/** One side of the merge, or null if the file is not a note. */
export function vaultPageSide(path: string, content: string): VaultPageSide | null {
  checkIndexText(path);
  checkIndexText(content);
  return (rawVaultPageSide(path, content) ?? null) as VaultPageSide | null;
}

/** The body composed from a pick per hunk; a missing pick keeps ours. */
export function mergeHunks(
  oursText: string,
  theirsText: string,
  picks: Readonly<Record<number, HunkPick>> = {},
): string {
  checkIndexText(oursText);
  checkIndexText(theirsText);
  return rawMergeHunks(oursText, theirsText, picks);
}

/** Both copies in one text, differing lines fenced with git-style markers. */
export function writeConflictMarkers(oursText: string, theirsText: string): string {
  checkIndexText(oursText);
  checkIndexText(theirsText);
  return rawWriteConflictMarkers(oursText, theirsText);
}

/** A note's frontmatter map and body. */
export function readFrontmatter(content: string): ParsedDocument {
  checkIndexText(content);
  return rawReadFrontmatter(content) as ParsedDocument;
}

/** Fields as a `---` block followed by body; null, undefined and empty lists are skipped. */
export function writeFrontmatter(fields: Readonly<Record<string, unknown>>, body: string): string {
  checkIndexText(body);
  return rawWriteFrontmatter(fields, body);
}

/** A value as JSON would carry it: dates become strings, undefined and functions become null. */
function plainJson(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text === undefined ? null : JSON.parse(text);
}

/** Three-way merge per field (Rust `merge_rows`). Rows cross as plain JSON, so a Date arrives as its ISO string and an undefined field counts as missing. */
export function mergeRows(
  base: Readonly<Record<string, unknown>>,
  local: Readonly<Record<string, unknown>>,
  remote: Readonly<Record<string, unknown>>,
): MergeResult {
  return rawMergeRows(plainJson(base), plainJson(local), plainJson(remote)) as MergeResult;
}

/** Equality as the database means it (Rust `same_value`). */
export function sameValue(a: unknown, b: unknown): boolean {
  return rawSameValue(plainJson(a), plainJson(b));
}

/** Line and hunk diff of two bodies (Rust `diff_body`). */
export function diffBody(ours: string, theirs: string): BodyDiff {
  checkIndexText(ours);
  checkIndexText(theirs);
  return rawDiffBody(ours, theirs) as BodyDiff;
}

/** Whether `text` holds git-style conflict markers (Rust `has_conflict_markers`). */
export function hasConflictMarkers(text: string): boolean {
  checkIndexText(text);
  return rawHasConflictMarkers(text);
}

/** A markdown image for `target` with `alt` text (Rust `markdown_image`). */
export function markdownImage(target: string, alt: string): string {
  checkIndexText(target);
  checkIndexText(alt);
  return rawMarkdownImage(target, alt);
}

/** Alt text from a file name (Rust `image_alt_from_filename`). */
export function imageAltFromFilename(name?: string | null): string {
  if (name) checkIndexText(name);
  return rawImageAltFromFilename(name ?? undefined);
}

/** File extension for an image MIME type (Rust `image_extension_for_mime`). */
export function imageExtensionForMime(mime: string): string {
  checkIndexText(mime);
  return rawImageExtensionForMime(mime);
}

/** Image targets in `body` under `prefix`. The body is normalised first; `prefix` is literal text, not a regex. */
export function imagePathsInBody(body: string, prefix: string): string[] {
  checkIndexText(body);
  checkIndexText(prefix);
  return rawImagePathsInBody(body, prefix) as string[];
}

/** `body` with markdown image syntax normalised (Rust `normalize_markdown_image_syntax`). */
export function normalizeMarkdownImageSyntax(body: string): string {
  checkIndexText(body);
  return rawNormalizeMarkdownImageSyntax(body);
}

/** `body` with blob links made relative to `filePath`, and the assets they name (Rust `to_relative_blob_links`). */
export function toRelativeBlobLinks(
  body: string,
  filePath: string,
): RelativeLinks {
  checkIndexText(body);
  checkIndexText(filePath);
  return rawToRelativeBlobLinks(body, filePath) as RelativeLinks;
}

/** The asset paths a body's relative links point at (Rust `relative_asset_paths`). */
export function relativeAssetPaths(body: string): RelativeAsset[] {
  checkIndexText(body);
  return rawRelativeAssetPaths(body) as RelativeAsset[];
}

/** Folder-relative asset links re-anchored; `resolved` maps `assets/<scope>/<path>` to a storage path (Rust `from_relative_blob_links_mapped`). */
export function fromRelativeBlobLinks(body: string, resolved: Readonly<Record<string, string>>): string {
  checkIndexText(body);
  return rawFromRelativeBlobLinks(body, resolved);
}

/** The folder of a project, named from its id and name (Rust `project_dir`). */
export function projectDir(project: { id: string; name: string }): string {
  checkIndexText(project.id);
  checkIndexText(project.name);
  return rawProjectDir(project.id, project.name);
}

/** The folder for one entity type under `projectRoot` (Rust `entity_dir`). */
export function entityDir(type: WorkspaceEntityType, projectRoot = ""): string {
  checkIndexText(projectRoot);
  return rawEntityDir(type, projectRoot);
}

/** The metadata folder under `projectRoot` (Rust `project_meta_dir`). */
export function projectMetaDir(projectRoot = ""): string {
  checkIndexText(projectRoot);
  return rawProjectMetaDir(projectRoot);
}

/** The short suffix that makes a folder name unique to its id (Rust `id_suffix`). */
export function idSuffix(id: string): string {
  checkIndexText(id);
  return rawIdSuffix(id);
}

/** `name` without its entity-kind suffix (Rust `strip_kind_suffix`). */
export function stripKindSuffix(name: string): string {
  checkIndexText(name);
  return rawStripKindSuffix(name);
}

/** The JSON entity kind a path holds, or null for any other path (Rust `json_kind_of_path`). */
export function jsonKindOfPath(path: string): WorkspaceJsonKind | null {
  checkIndexText(path);
  return (rawJsonKindOfPath(path) ?? null) as WorkspaceJsonKind | null;
}

/** Whether `path` is a file the app owns rather than user content (Rust `is_app_owned_path`). */
export function isAppOwnedPath(path: string): boolean {
  checkIndexText(path);
  return rawIsAppOwnedPath(path);
}

/** The project's folder-mirror files for a snapshot (Rust `serialize_workspace`). */
export function serializeWorkspace(
  snapshot: object,
  project: { id: string; name: string },
): { files: Record<string, string>; assets: SerializedAsset[] } {
  const out = rawSerializeWorkspace(JSON.stringify(snapshot), project.id, project.name) as SerializedWorkspace;
  return { files: Object.fromEntries(out.files), assets: out.assets };
}

/** Row counts of a snapshot, as the manifest records them (Rust `workspace_snapshot_counts`). */
export function workspaceSnapshotCounts(snapshot: object): WorkspaceSnapshotCounts {
  return rawWorkspaceSnapshotCounts(JSON.stringify(snapshot)) as WorkspaceSnapshotCounts;
}

/** Every importable entity in a folder's files (Rust `parse_workspace_folder`). Throws over MAX_INDEX_TEXT_UTF16 units per file. */
export function parseWorkspaceFolder(files: Readonly<Record<string, string>>): ParsedEntity[] {
  return rawParseWorkspaceFolder(Object.entries(files)) as ParsedEntity[];
}

/**
 * What importing `parsed` would do to `existing` (Rust `diff_workspace`).
 * `origin` is asked once for every parsed path up front, so it must be pure.
 */
export function diffWorkspace(
  parsed: readonly ParsedEntity[],
  existing: readonly ExistingEntity[],
  options: { origin?(path: string): ChangeSide } = {},
): ImportDiff {
  const origin = options.origin;
  const sides = origin ? Object.fromEntries(parsed.map((entity) => [entity.path, origin(entity.path)])) : undefined;
  return rawDiffWorkspace(parsed, existing, sides) as ImportDiff;
}

/** Path of one of the project's JSON data files (Rust `json_data_path`). */
export function jsonDataPath(projectRoot: string, kind: WorkspaceJsonKind): string {
  checkIndexText(projectRoot);
  return rawJsonDataPath(projectRoot, kind);
}

/** The rows of a JSON data file, or null when it is not a JSON array (Rust `parse_json_data`). */
export function parseJsonData(path: string, content: string, kind: WorkspaceJsonKind): ParsedJsonData | null {
  checkIndexText(path);
  checkIndexText(content);
  return (rawParseJsonData(path, content, kind) ?? null) as ParsedJsonData | null;
}

/** What importing a JSON data file would do to the stored rows (Rust `diff_json_data`). */
export function diffJsonData(
  parsed: ParsedJsonData,
  existing: readonly Readonly<Record<string, unknown>>[],
  options: { origin?(path: string): ChangeSide } = {},
): JsonDiff {
  return rawDiffJsonData(parsed, JSON.stringify(existing), options.origin?.(parsed.path)) as JsonDiff;
}

/** How many entries there are of each action (Rust `count_json_actions`). */
export function countJsonActions(entries: readonly JsonDiffEntry[]): ActionCounts {
  return rawCountJsonActions(entries) as ActionCounts;
}

/** Words in plain text: runs of non-whitespace (Rust `count_words`). */
export function countWords(text: string): number {
  return rawCountWords(text);
}

/** Colour slot 1..6 for a tag (Rust `tag_tone`); a tag keeps its slot everywhere. */
export function tagTone(tag: string): number {
  checkIndexText(tag);
  return rawTagTone(tag);
}

/** Heading anchor id: trimmed, lowercased, non-alphanumeric runs as one hyphen (Rust `heading_slug`). */
export function headingSlug(text: string): string {
  checkIndexText(text);
  return rawHeadingSlug(text);
}

/** Drop `![alt](prefix+path)` refs whose path is not in `resolved` (Rust `strip_unresolved_image_refs`). */
export function stripUnresolvedImageRefs(body: string, prefix: string, paths: readonly string[], resolved: readonly string[]): string {
  checkIndexText(body);
  return rawStripUnresolvedImageRefs(body, prefix, paths, resolved);
}

/** Crop, side and width split out of an image alt (Rust `parse_md_image_alt`). */
export function parseMdImageAlt(raw: string): MdImageAlt {
  checkIndexText(raw);
  return rawParseMdImageAlt(raw) as MdImageAlt;
}

/** The alt for a figure's own text and placement, in the spelling the reader reads (Rust `with_md_image_alt`). */
export function withMdImageAlt(alt: string, placement: MdPlacement): string {
  checkIndexText(alt);
  return rawWithMdImageAlt(alt, placement);
}

/** The alt for a width, keeping any crop or side; `null` clears it (Rust `with_image_width`). */
export function withImageWidth(alt: string, width: string | null): string {
  checkIndexText(alt);
  return rawWithImageWidth(alt, width);
}

/** Rewrite the `ordinal`-th image whose alt is `alt` to the patched placement (Rust `set_image_placement`). */
export function setImagePlacement(body: string, alt: string, ordinal: number, patch: ImagePlacementPatch): string {
  checkIndexText(body);
  checkIndexText(alt);
  // serde reads a key that is present as an explicit null, so an absent (undefined) field is dropped here to keep its value.
  const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  return rawSetImagePlacement(body, alt, ordinal, fields);
}

/** The indices of `rows` in the chosen hit order (Rust `sort_hit_order`). */
export function sortHitOrder(rows: readonly HitKey[], order: HitSort): number[] {
  return rawSortHitOrder(rows, order) as number[];
}

/** Whether a key press opens the preview (Rust `is_preview_key`). */
export function isPreviewKey(event: PaletteKey, inTextBox: boolean): boolean {
  return rawIsPreviewKey(event, inTextBox) as boolean;
}

/** The headings present, in display order, each with the indices of its rows (Rust `group_palette_rows`). */
export function groupPaletteRows(groups: readonly PaletteGroup[]): GroupedRows[] {
  return rawGroupPaletteRows(groups) as GroupedRows[];
}

/** The indices of the labels that hold the query, names that start with it first (Rust `matching_page_indices`). */
export function matchingPageIndices(labels: readonly string[], query: string): number[] {
  checkIndexText(query);
  return rawMatchingPageIndices(labels, query) as number[];
}

/** Every index for an empty query, else the page rule (Rust `command_match_indices`). */
export function commandMatchIndices(labels: readonly string[], query: string): number[] {
  checkIndexText(query);
  return rawCommandMatchIndices(labels, query) as number[];
}

/** The palette mode a key press opens, or `null` (Rust `palette_mode_for`). */
export function paletteModeFor(event: PaletteKey): PaletteMode | null {
  return (rawPaletteModeFor(event) as PaletteMode | undefined) ?? null;
}

/** The caches a write of this resource type clears, or `null` for an unknown name (Rust `invalidation_plan`). */
export function invalidationPlan(resourceType: string): InvalidationPlan | null {
  checkIndexText(resourceType);
  return (rawInvalidationPlan(resourceType) as InvalidationPlan | undefined) ?? null;
}

/** Whether the name is a resource type the cache map knows (Rust `is_known_resource_type`). */
export function isKnownResourceType(value: string): value is ResourceType {
  return rawIsKnownResourceType(value) as boolean;
}

/** Every resource type with the caches its writes clear (Rust `invalidation_map`). */
export function invalidationMap(): InvalidationEntry[] {
  return rawInvalidationMap() as InvalidationEntry[];
}

/** Plain-text card preview of a markdown body, cut to `max` UTF-16 units (Rust `card_snippet`). */
export function cardSnippet(body: string, max = 180): string {
  checkIndexText(body);
  return rawCardSnippet(body, max);
}

/** Two sets of counts summed (Rust `add_counts`). */
export function addCounts(a: Readonly<ActionCounts>, b: Readonly<ActionCounts>): ActionCounts {
  return rawAddCounts(a, b) as ActionCounts;
}

/**
 * What mirroring `serialized` into the folder would do (Rust `plan_mirror`), without
 * touching it. `disk` holds the folder's text for every file path and for every previous
 * path that is not present but has a `base` entry; a missing key is a missing file.
 * Assets are not fetched: their folder paths only count as present, so they are never removed.
 */
export function planMirror(
  serialized: { files: Readonly<Record<string, string>>; assets: readonly SerializedAsset[] },
  previousPaths: readonly string[],
  base: Readonly<Record<string, string>> | undefined,
  disk: Readonly<Record<string, string>>,
): MirrorResult {
  return rawPlanMirror(
    Object.entries(serialized.files),
    serialized.assets.map((asset) => asset.folderPath),
    previousPaths,
    base,
    disk,
  ) as MirrorResult;
}

/** The automatic paste rules over `input` (Rust `clean_pasted_text`). */
export function cleanPastedText(input: string, settings: PasteSettings): CleanPasteResult {
  checkIndexText(input);
  return rawCleanPastedText(input, settings) as CleanPasteResult;
}

/** Whether a paste at UTF-16 `offset` lands in code or frontmatter (Rust `paste_lands_in_verbatim_context`). */
export function pasteLandsInVerbatimContext(document: string, offset: number): boolean {
  checkIndexText(document);
  return rawPasteLandsInVerbatimContext(document, Math.max(0, Math.floor(offset)));
}

/** Rejoins wrapped terminal or PDF lines (Rust `clean_wrapped_text`). */
export function cleanWrappedText(input: string, options: WrappedTextOptions): TextResult {
  checkIndexText(input);
  return rawCleanWrappedText(input, options) as TextResult;
}

/** Repairs text copied out of a PDF (Rust `clean_pdf_text`). */
export function cleanPdfText(input: string, options: PdfTextOptions): TextResult {
  checkIndexText(input);
  return rawCleanPdfText(input, options) as TextResult;
}

/** Moves commas to the chosen side of a closing quote (Rust `apply_comma_placement`). */
export function applyCommaPlacement(input: string, placement: CommaPlacement): TextResult {
  checkIndexText(input);
  return rawApplyCommaPlacement(input, placement) as TextResult;
}

/** A tab-separated text as a Markdown table, or unchanged (Rust `tab_separated_to_markdown_table`). */
export function tabSeparatedToMarkdownTable(input: string): TextResult {
  checkIndexText(input);
  return rawTabSeparatedToMarkdownTable(input) as TextResult;
}

/** The URLs in `text` cleaned by the built-in rules plus `rules` (Rust `clean_urls_in_text`). */
export function cleanUrlsWithRules(text: string, rules: readonly string[]): UrlCleanupResult {
  checkIndexText(text);
  return rawCleanUrlsWithRules(text, rules) as UrlCleanupResult;
}

/** The default paste settings (Rust `PasteSettings::default`). */
export function defaultPasteSettings(): PasteSettings {
  return rawDefaultPasteSettings() as PasteSettings;
}

/** Settings the pipeline can trust from whatever was stored (Rust `normalize_paste_settings`). */
export function normalizePasteSettings(raw: unknown): PasteSettings {
  const json = JSON.stringify(raw) ?? "null";
  checkIndexText(json);
  return rawNormalizePasteSettings(json) as PasteSettings;
}

/** The link removal rules in a textarea, one per line (Rust `parse_link_removal_text`). */
export function parseLinkRemovalText(text: string): string[] {
  checkIndexText(text);
  return rawParseLinkRemovalText(text) as string[];
}
