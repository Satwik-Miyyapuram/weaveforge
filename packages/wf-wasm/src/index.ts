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
  maxIndexTextUtf16 as rawMaxIndexTextUtf16,
  maxFusionIds as rawMaxFusionIds,
  fuseRankings as rawFuseRankings,
  buildExcerpt as rawBuildExcerpt,
  changedSide as rawChangedSide,
  decideGitSyncPath as rawDecideGitSyncPath,
  decideVaultCommit as rawDecideVaultCommit,
  redactSecret as rawRedactSecret,
  planDelta as rawPlanDelta,
  applyDelta as rawApplyDelta,
  normalizeArxivId as rawNormalizeArxivId,
  extractDoi as rawExtractDoi,
  mergeVaultPage as rawMergeVaultPage,
  vaultPageBase as rawVaultPageBase,
  vaultPageSide as rawVaultPageSide,
  mergeHunks as rawMergeHunks,
  mergeRows as rawMergeRows,
  sameValue as rawSameValue,
  invalidationPlan as rawInvalidationPlan,
  writeScope as rawWriteScope,
  lwwClearTarget as rawLwwClearTarget,
  lwwNotifyResource as rawLwwNotifyResource,
  ArchiveBudget,
} from "../pkg/wf_wasm.js";
import type {
  ActionCounts,
  AssetRef,
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
  ReanchorPlan,
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
  WriteScope,
} from "./bindings.js";
import { checkIndexText } from "./text-check.js";

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
  AssetRef,
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
  ReanchorPlan,
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
export type {
  FigureBox,
  FigureHandle,
  FigureImageFrame,
  FigureOrderStep,
  FigurePlacement,
  FigureRect,
  DocumentMode,
  TabRef,
  PaneLeaf,
  SplitDirection,
  PaneSplit,
  PaneNode,
  PaneLayout,
  PaneCommand,
  TabMenuAction,
  TabMenuCommand,
  TabGroup,
  TabGroupCommand,
  TabRun,
  TreeNodeKind,
  WorkspaceTreeNode,
  NoteNode,
  PaperEntry,
  SectionNode,
  WorkspaceLogEntry,
  OverleafProject,
  WorkspaceTreeInput,
  VisibleRow,
  FilteredRows,
  ListItemKind,
  ListEntry,
  ListItemEntry,
  ListsTreeInput,
  FeedMilestone,
  PlanWidgetData,
  PlanWidgetItem,
  CitationSignals,
} from "./bindings.js";
export { init, initSync };
export * from "./feature-wrappers.js";
// Plain Rust exports: no TS wrapper, callers get the wasm-bindgen function itself.
export { sessionClaims } from "../pkg/wf_wasm.js";
export type {
  AnnotationSource,
  ConflictPicks,
  ConflictResolution,
  PdfSourceKind,
} from "./bindings.js";
export type {
  AnnotationQuotationTypeRow,
  PaperFieldDefRow,
  PaperFieldValueRow,
  PaperRow,
  PlanFeedUrls,
  PlanTimeline,
} from "./bindings.js";
export type {
  AnnotationBox,
  AnnotationStroke,
  FigureGeometry,
  PageAnnotationGeometry,
  PagePicture,
  PictureDraftInput,
  PictureMeta,
  ProjectGeometryInput,
} from "./bindings.js";

/**
 * A snippet of `body` around the densest cluster of `terms`, like `buildExcerpt`
 * in @weaveforge/core. Offsets are UTF-16 units into `text`.
 */
export function buildExcerpt(
  body: string,
  terms: readonly string[],
  options: { maxChars?: number; singleLine?: boolean } = {},
): { text: string; highlights: ExcerptRange[] } {
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

/** Whether one workspace path goes into git, and why not. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function decideGitSyncPath(
  relPath: string,
  sizeBytes: number,
  maxFileBytes: number = GIT_SYNC_MAX_FILE_BYTES,
): { include: true } | { include: false; reason: GitSyncSkipReason } {
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


/** Declared-size budget for an import, checked as entries are inflated (Rust `ArchiveBudget`). */
export function createArchiveBudget(limits: ArchiveLimitsInput): ArchiveBudget {
  return new ArchiveBudget(limits);
}

/** The caps, an archive entry as declared, and what an import does with it (Rust `archive_limits`). */
export type {
  ArchiveLimits as ArchiveLimitsInput,
  EntryInfo as ArchiveEntryFacts,
  PlannedEntry as PlannedArchiveEntry,
} from "./bindings.js";
import type { ArchiveLimits as ArchiveLimitsInput } from "./bindings.js";

export {
  coreInfo,
  describeChanges,
  diffBody,
  extractPageMetadata,
  guessBlobContentType,
  hasConflictMarkers,
  headingSlug,
  indexTerms,
  isSafeWorkspacePath,
  isUnderIgnoredFolder,
  pageImportRefusal,
  parsePaperRef,
  parseQuery,
  planArchiveEntries,
  readFrontmatter,
  safeWorkspacePath,
  stampWorkspaceId,
  stripArchiveRoot,
  tagTone,
  tokenize,
  writeConflictMarkers,
  writeFrontmatter,
} from "../pkg/wf_wasm.js";

export {
  canStoreUnchanged,
  cardSnippet,
  countWords,
  describePull,
  describePush,
  digestText,
  invalidationMap,
  isKnownResourceType,
  maxFusionIds,
  maxIndexTextUtf16,
} from "../pkg/wf_wasm.js";

/** The bare arXiv id in `value` (a URL or `arXiv:` prefix), or undefined. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function normalizeArxivId(value?: string): string | undefined {
  if (!value) return undefined;
  return rawNormalizeArxivId(value) ?? undefined;
}

/** The DOI in `value`, or undefined. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function extractDoi(value?: string): string | undefined {
  if (!value) return undefined;
  return rawExtractDoi(value) ?? undefined;
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
  return (rawVaultPageBase(path, content) ?? null) as VaultPageBase | null;
}

/** One side of the merge, or null if the file is not a note. */
export function vaultPageSide(path: string, content: string): VaultPageSide | null {
  return (rawVaultPageSide(path, content) ?? null) as VaultPageSide | null;
}

/** The body composed from a pick per hunk; a missing pick keeps ours. */
export function mergeHunks(
  oursText: string,
  theirsText: string,
  picks: Readonly<Record<number, HunkPick>> = {},
): string {
  return rawMergeHunks(oursText, theirsText, picks);
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

/** The caches a write of this resource type clears, or `null` for an unknown name (Rust `invalidation_plan`). */
export function invalidationPlan(resourceType: string): InvalidationPlan | null {
  return (rawInvalidationPlan(resourceType) as InvalidationPlan | undefined) ?? null;
}

/** The repo and screen caches one write of this resource type clears, or `null` for an unknown name (Rust `write_scope`). */
export function writeScope(resourceType: string): WriteScope | null {
  return (rawWriteScope(resourceType) as WriteScope | undefined) ?? null;
}

/** The resource type a realtime `lww` broadcast clears, or `null` to clear everything (Rust `lww_clear_target`). */
export function lwwClearTarget(resourceType: string | null | undefined): string | null {
  if (resourceType) checkIndexText(resourceType);
  return rawLwwClearTarget(resourceType ?? undefined) ?? null;
}

/** The `resourceType` of a write's `lww` payload, or `null` for an empty or missing one (Rust `lww_notify_resource`). */
export function lwwNotifyResource(resourceType: string | null | undefined): string | null {
  if (resourceType) checkIndexText(resourceType);
  return rawLwwNotifyResource(resourceType ?? undefined) ?? null;
}
export type { InkUndoEntry, InkUndoPatch, InkUndoState, LatexSectionTree } from "./bindings.js";
