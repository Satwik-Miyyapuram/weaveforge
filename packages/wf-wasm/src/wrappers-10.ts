/**
 * Typed wrappers over the raw wasm exports, folded from 22 one-module files:
 * search-history, search-refresh-diff, search-related, search-result-dedupe, search-retry,
 * search-tuning, semantic-scholar-citation, sharing, shell-paths, sidecar-args, signed-out,
 * storage-blob-access, storage-config, sync-adoption-plan, sync-conflict-attention,
 * sync-conflict-resolve, sync-device-session, sync-dot, sync-folder-merge, sync-panel-labels,
 * sync-pglite-sql, sync-phase.
 */
import {
  blobStorageBuckets as rawBlobStorageBuckets,
  citationCandidates as rawCitationCandidates,
  citationContexts as rawCitationContexts,
  citationExternalIdRef as rawCitationExternalIdRef,
  citationIntents as rawCitationIntents,
  collapseToEntities as rawCollapseHits,
  countOpen as rawCountOpen,
  decodeShareLinkToken as rawDecodeShareLinkToken,
  diffRefreshPlan as rawDiffRefreshPlan,
  distinctRelated as rawDistinctRelatedIndices,
  documentBoost as rawDocumentBoost,
  findRelated as rawFindRelated,
  fuzzinessForTerm as rawFuzzinessForTerm,
  homeConfigPath as rawHomeConfigPath,
  isSettled as rawIsSettled,
  isSignedOutRefusal as rawIsSignedOutRefusal,
  mcpClientConfigs as rawMcpClientConfigs,
  memberNameMap as rawMemberNameMap,
  mergeBothChanged as rawMergeBothChanged,
  nextManifest as rawNextManifest,
  normalizeCommentInput as rawNormalizeCommentInput,
  normalizeSearchHistory as rawNormalizeSearchHistory,
  normalizeShareInput as rawNormalizeShareInput,
  pgArray as rawPgArray,
  planRenames as rawPlanRenames,
  readStorageConfig as rawReadStorageConfig,
  rememberSearchQuery as rawRememberSearchQuery,
  resolveWithRow as rawResolveWithRow,
  retryFuzzinessForTerm as rawRetryFuzzinessForTerm,
  shareableTypes,
  sharedPaperAnnotationSummary as rawSharedPaperAnnotationSummary,
  shouldRetrySearch as rawShouldRetrySearch,
  syncDot as rawSyncDot,
} from "../pkg/wf_wasm.js";
import type {
  BlobClientConfig,
  BlobProviderId,
  BlobRuntime,
  ColdFields,
  Comment as CommentRecord,
  CommentRow as CommentRowInput,
  ConflictDeletionAction,
  DocumentBoostOptions,
  ImportDiffEntry,
  MemberName,
  MemberNameSource,
  NewCommentInput,
  NewShareInput,
  PaperRef,
  R2Fields,
  RelatedResult,
  SearchField,
  Share as ShareRecord,
  SharedItem as SharedItemRecord,
  SharedPaperAnnotationSummary,
  SharedSource as SharedSourceInput,
  ShareRow as ShareRowInput,
  StorageConfig,
  SyncDot,
  SyncDotInput,
  VaultPageBase,
} from "./bindings.js";

export {
  afterCycle,
  afterFailure,
  batchReferenceLists,
  blobProviderForRuntime,
  claimDigest,
  coldBlobClientConfig,
  commentFromRow,
  countActionList,
  countActions,
  crdtEditableShareTypes,
  deletionAction,
  deviceLabel,
  deviceMarkers,
  encodeShareLinkToken,
  explainArm,
  folderTitleFromPath,
  forgetSearchQuery,
  groupHunks,
  humanize,
  ident,
  initialPhase,
  isBlanketShare,
  isCaughtUp,
  isLiteral,
  jsonEditSince,
  keepAllPicks,
  keepBothTitle,
  kindOf,
  maxSignedUrlPaths,
  mayDriveDevice,
  missingR2ConfigMessage,
  movedPath,
  nameOf,
  needsPerson,
  nextCitationPageOffset,
  objectKey,
  parseSidecarArgs,
  pickProjectFolder,
  plural,
  projection,
  r2BlobClientConfig,
  readContentType,
  readMirrorBase,
  readMirrorBases,
  rekeyManifestText,
  retryFuzzinessForTerm,
  s2PaperId,
  sessionAction,
  settleConflict,
  shareableTypes,
  shareAllowsComment,
  shareAllowsEdit,
  shareCoversResource,
  sharedItem,
  sharedItemHref,
  sharedItemTypeLabel,
  sharedReadPlan,
  sharedResourceHref,
  shareFromRow,
  shareLinkDefaultTtlDays,
  shareLinkFromRow,
  shareSupportsEditAccess,
  shareTargets,
  shouldRetrySearch,
  splitTopLevel,
  uniqueDeviceName,
  unstampForCompare,
  uploadContentType,
} from "../pkg/wf_wasm.js";
export type {
  ConflictDeletionAction,
  SearchField,
  SyncDot,
  SyncDotInput,
  SyncDotState,
} from "./bindings.js";

// --- search-history ---
/**
 * Recent-query list (Rust `search_history`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/search/search-history.ts.
 */
export const MAX_SEARCH_HISTORY = 12;

/** Prepend a query, most-recent first. Repeats and abandoned prefixes are dropped. */
export function rememberSearchQuery(
  history: readonly string[],
  query: string,
  max = MAX_SEARCH_HISTORY,
): string[] {
  return rawRememberSearchQuery([...history], query, max);
}

/** Drop anything that is not a usable query string. Non-array input yields []. */
export function normalizeSearchHistory(raw: unknown, max = MAX_SEARCH_HISTORY): string[] {
  return rawNormalizeSearchHistory(raw, max);
}

// --- search-refresh-diff ---
/**
 * Partial-refresh planning (Rust `refresh_diff`). A document is re-added only
 * when it is new, changed, or not provably unchanged. Its print is
 * `JSON.stringify(doc)`, computed here so Rust sees opaque strings.
 */
/**
 * What a partial refresh must touch, and the prints to remember after it.
 * `add` holds the fresh documents to (re)tokenise, and `remove` the held ids
 * that no longer exist.
 */
export function diffRefreshPlan<T extends { id: string }>(
  prints: ReadonlyMap<string, string>,
  held: readonly string[],
  fresh: readonly T[],
): { remove: string[]; add: T[]; prints: Map<string, string> } {
  const raw: {
    remove: string[];
    add: number[];
    prints: { id: string; print: string }[];
  } = rawDiffRefreshPlan(
    [...prints].map(([id, print]) => ({ id, print })),
    held,
    fresh.map((doc) => ({ id: doc.id, print: JSON.stringify(doc) })),
  );
  return {
    remove: raw.remove,
    add: raw.add.map((index) => fresh[index] as T),
    prints: new Map(raw.prints.map((entry) => [entry.id, entry.print])),
  };
}

// --- search-related ---
/**
 * Related-document arm helpers (Rust `search::related`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/parts.ts.
 */
/** Below this the seed has too little neighbourhood for a walk to say anything. */
export const MIN_SEED_DEGREE_FOR_PPR = 3;

/** Same graph shape as the PPR wrappers: edges become `{ node, neighbours }` in insertion order. */
function toWasmGraph(graph: { nodes: string[]; edges: Map<string, string[]> }) {
  return {
    nodes: graph.nodes,
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours })),
  };
}

/**
 * Related documents for a seed: graph walk first, then the lexical arm, then the tag arm.
 * The first non-empty arm wins. `lexical` and `tagged` run only when the arms before them came
 * back empty, so they are called lazily from Rust.
 */
/**
 * A related result as Rust sends it: `score` is always a number, and `arms` and
 * `similarity` are left out rather than null (bindings show f64 and Option as nullable).
 */
export type RelatedHit = Pick<RelatedResult, "id" | "arm"> & {
  score: number;
  arms?: RelatedResult["arm"][];
  similarity?: number;
};

export function findRelated(
  seedId: string,
  deps: {
    graph: { nodes: string[]; edges: Map<string, string[]> };
    lexical?: (seedId: string, limit: number) => { id: string; score: number }[];
    tagged?: (seedId: string, limit: number) => { id: string; score: number }[];
  },
  limit = 10,
  options: { numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number } = {},
): RelatedHit[] {
  return rawFindRelated(
    toWasmGraph(deps.graph),
    seedId,
    limit,
    { numWalks: options.numWalks, maxSteps: options.maxSteps, damping: options.damping },
    options.rng ?? Math.random,
    (s: string, l: number) => deps.lexical?.(s, l) ?? [],
    (s: string, l: number) => deps.tagged?.(s, l) ?? [],
  ) as RelatedHit[];
}

// --- search-result-dedupe ---
/**
 * Hit collapsing and related-list de-duplication (Rust `result_dedupe`). The
 * callbacks stay here: `entityDoc` and `resolve` look up records, and only their
 * results cross into WASM. Merges come back as indices and are replayed in order.
 */
/**
 * Fold hits onto the entity they belong to. A PDF page is stood in for by its
 * paper's own document when `entityDoc` finds one. The seed's entity is dropped.
 * `entityDoc` runs only for non-seed PDF hits.
 */
export function collapseToEntities(
  hits: readonly { id: string; kind: string; entityId: string; score: number }[],
  seed: { entityId: string },
  entityDoc: (hit: { id: string; kind: string; entityId: string; score: number }) => string | null = () => null,
): { id: string; score: number }[] {
  return rawCollapseHits(
    hits.map((hit) => ({
      id: hit.id,
      entityId: hit.entityId,
      score: hit.score,
      isPdf: hit.kind === "pdf",
      entityDoc: hit.kind === "pdf" && hit.entityId !== seed.entityId ? entityDoc(hit) : null,
    })),
    seed.entityId,
  );
}

/**
 * Drop the entries of a related list that name something already listed: the
 * same entity, or the same title within the same kind, or a cut-off copy of a
 * listed title. The first (best-ranked) entry wins, so order is kept. `merge` is
 * told about each entry it absorbed. The records themselves are left alone.
 */
export function distinctRelated<T extends { id: string }>(
  results: readonly T[],
  resolve: (id: string) => { kind: string; entityId: string; title: string } | null,
  limit = Infinity,
  seedId?: string,
  merge?: (kept: T, dropped: T) => void,
): T[] {
  const seed = seedId ? resolve(seedId) : null;
  const raw: {
    kept: number[];
    merges: { owner: number; dropped: number }[];
  } = rawDistinctRelatedIndices({
    entries: results.map((result) => {
      const doc = resolve(result.id);
      return {
        id: result.id,
        doc: doc ? { kind: doc.kind, entityId: doc.entityId, title: doc.title } : null,
      };
    }),
    seed: seed ? { kind: seed.kind, entityId: seed.entityId, title: seed.title } : null,
    limit: Number.isFinite(limit) ? limit : null,
  });
  for (const { owner, dropped } of raw.merges) {
    merge?.(results[owner] as T, results[dropped] as T);
  }
  return raw.kept.map((index) => results[index] as T);
}

// --- search-retry ---
/**
 * Second-chance matching (Rust `search_retry`), re-exported from index.ts.
 * Keeps the shape of packages/core/src/search/search-retry.ts: `planFuzzyRetry`
 * returns `{ retry, fuzzinessFor }`, with the rule itself in Rust.
 */
/**
 * Decide whether, and how, to re-run a query that returned no results. The
 * fuzziness for each term is absolute (max edit distance), or 0 to leave it alone.
 */
export function planFuzzyRetry(input: { resultCount: number; termCount: number }): {
  retry: boolean;
  fuzzinessFor(term: string): number;
} {
  const retry = rawShouldRetrySearch(input.resultCount, input.termCount);
  return {
    retry,
    fuzzinessFor(term: string): number {
      return rawRetryFuzzinessForTerm(term, retry);
    },
  };
}

// --- search-tuning ---
/**
 * Search ranking rules (Rust `search_tuning`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/parts.ts.
 */
export const FIELD_BOOSTS = {
  title: 8,
  aliases: 6,
  headings: 3,
  tags: 3,
  path: 2,
  body: 1,
} as const;

export const SEARCH_FIELDS: SearchField[] = ["title", "aliases", "headings", "tags", "path", "body"];

/** Terms shorter than this are matched exactly; prefix matching needs length. */
export const MIN_PREFIX_LENGTH = 3;

/** Cap on indexed body length. Beyond this a document is noise in every query. */
export const MAX_INDEXED_BODY_CHARS = 256_000;

/** Corpus size past which the client index is likely to strain. */
export const LARGE_CORPUS_WARNING = 5_000;

/**
 * Edit distance as a fraction of term length, graduated by length.
 */
export function fuzzinessForTerm(term: string): number {
  return rawFuzzinessForTerm(term);
}

/**
 * Document-level multiplier, applied on top of field scoring. `options.now`
 * defaults to the current time and is resolved here, not in Rust.
 */
export function documentBoost(
  doc: { degree: number; updatedAt: string },
  options: DocumentBoostOptions & { now?: number } = {},
): number {
  const now = options.now ?? Date.now();
  return rawDocumentBoost(doc, options, now);
}

// --- semantic-scholar-citation ---
/**
 * Semantic Scholar citation field rules (Rust `semantic_scholar_citation`), re-exported from index.ts.
 * Keeps the results of the helpers in
 * apps/web/src/features/relations/infrastructure/parts.ts.
 */
/** A citing paper as the citation source keeps it (matches the app's `CitationCandidate`). */
export interface CitationCandidateWire {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  url: string;
  citationCount?: number;
  contexts?: string[];
  intents?: string[];
  isInfluential?: boolean;
}

/** Trimmed, non-empty context snippets, or undefined when none remain. */
export function citationContexts(raw: unknown): string[] | undefined {
  return (rawCitationContexts(raw) as string[] | null) ?? undefined;
}

/** The known citation intents, or undefined when none remain. */
export function citationIntents(raw: unknown): string[] | undefined {
  return (rawCitationIntents(raw) as string[] | null) ?? undefined;
}

/** The lookup reference for a paper's external ids (arXiv first, then DOI), or null. */
export function citationExternalIdRef(ids: unknown): PaperRef | null {
  return (rawCitationExternalIdRef(ids) as PaperRef | null) ?? null;
}

/** The candidates from one page of `/citations` edges, in order. */
export function citationCandidates(data: unknown): CitationCandidateWire[] {
  return rawCitationCandidates(data) as CitationCandidateWire[];
}

// --- sharing ---
/**
 * Sharing and comment domain helpers (Rust `sharing`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/sharing/domain/share.ts and comment.ts.
 */
export type {
  CommentRecord,
  CommentRowInput,
  ShareRecord,
  ShareRowInput,
  SharedItemRecord,
  SharedSourceInput,
};

/** A thrown validation message becomes an `Error` named like the TS validation class. */
function asError(thrown: unknown, name: string): unknown {
  // Rust rejects with a string or with an unnamed `Error` (serde_wasm_bindgen).
  if (thrown instanceof Error && thrown.name === "Error") {
    thrown.name = name;
    return thrown;
  }
  if (typeof thrown !== "string") return thrown;
  const error = new Error(thrown);
  error.name = name;
  return error;
}

/** Normalize + validate a grant request (pure). Throws an `Error` with the validation message. */
export function normalizeShareInput(input: NewShareInput): Required<NewShareInput> {
  // An unknown type would fail to deserialize in Rust; report it as the TS rule did.
  if (input.recipientId && !shareableTypes().includes(input.resourceType)) {
    throw asError(`Unknown resource type "${input.resourceType}".`, "ShareValidationError");
  }
  try {
    return rawNormalizeShareInput(input) as Required<NewShareInput>;
  } catch (error) {
    throw asError(error, "ShareValidationError");
  }
}

/** Normalize + validate a comment request. Throws an `Error` with the validation message. */
export function normalizeCommentInput(input: NewCommentInput): NewCommentInput {
  try {
    return rawNormalizeCommentInput(input) as NewCommentInput;
  } catch (error) {
    throw asError(error, "CommentValidationError");
  }
}

/** Bytes of a share-link token; accepts either base64 alphabet, padded or not. Throws on a mangled token. */
export function decodeShareLinkToken(encoded: string): Uint8Array {
  try {
    return rawDecodeShareLinkToken(encoded);
  } catch (error) {
    throw asError(error, "InvalidCharacterError");
  }
}

/** Display name per member id: full name, else email, else `"Member"` (Rust `member_name_map`). */
export function memberNameMap(members: readonly MemberNameSource[]): Map<string, string> {
  const names = rawMemberNameMap([...members]) as MemberName[];
  return new Map(names.map((m) => [m.id, m.name]));
}

/** Count and up to three sample texts of a paper's Zotero annotations, notes excluded (Rust `shared_paper_annotation_summary`). */
export function sharedPaperAnnotationSummary(metadata: Record<string, unknown> | undefined): SharedPaperAnnotationSummary {
  return rawSharedPaperAnnotationSummary(metadata ?? null) as SharedPaperAnnotationSummary;
}

// --- shell-paths ---
/**
 * Desktop shell path naming (Rust `shell_paths` and `mcp_config_rewrite::mcp_client_configs`), re-exported
 * from index.ts. The caller passes `path.sep` and `process.platform`; the file IO stays in TypeScript.
 */
/** The home pointer file for a build variant: `desktop.json`, or `desktop-<variant>.json`. */
export function homeConfigPath(home: string, variant: string | null, sep: string): string {
  return rawHomeConfigPath(home, variant ?? undefined, sep);
}

/** Cursor's and VS Code's user MCP config files on this platform, with the key their servers live under. */
export function mcpClientConfigs(
  home: string,
  platform: string,
  appData: string | null,
  sep: string,
): { file: string; key: "mcpServers" | "servers" }[] {
  return rawMcpClientConfigs(home, platform, appData ?? undefined, sep) as {
    file: string;
    key: "mcpServers" | "servers";
  }[];
}

// --- sidecar-args ---
/**
 * Sidecar command-line parsing (Rust `sidecar_args`), re-exported from feature-wrappers.ts.
 * Reading `process.argv` and resolving paths stay in apps/shell/sidecar/src/main.ts.
 */
/** A successful parse. Paths are as given on the command line; absent options are `null`. */
export interface SidecarArgsPlan {
  kind: "ok";
  /** The `--data-dir` value. */
  dataDir: string;
  /** Every `--migrations` value, in order. */
  migrations: string[];
  /** The `--backups` value. */
  backupsDir: string;
  /** The `--migrate-from` value. */
  migrateFrom: string | null;
  /** The `--artifacts` value. */
  artifacts: string | null;
  /** The `--bridge` value. */
  bridge: string | null;
  /** The `--app-version` value. */
  appVersion: string | null;
  /** The `--home-variant` value. */
  homeVariant: string | null;
  /** True when `--no-local-api` was passed. */
  noLocalApi: boolean;
}

/** A failed parse. The message is printed after `weaveforge-sidecar: `. */
export interface SidecarArgsError {
  kind: "error";
  message: string;
}

export type SidecarArgsReply = SidecarArgsPlan | SidecarArgsError;

// --- signed-out ---
/**
 * Signed-out refusal check (Rust `signed_out`), re-exported from index.ts.
 */
/** True when a server refusal, with no sign-in, means "sign in" rather than "not allowed" (Rust `is_signed_out_refusal`). */
export function isSignedOutRefusal(message: string, code: string | null): boolean {
  return rawIsSignedOutRefusal(message, code ?? undefined);
}

// --- storage-blob-access ---
/**
 * Blob access constants (Rust `storage::blob_access`), re-exported from index.ts.
 */
/** A bucket a user's blobs live in. The list is Rust `blob_access::BLOB_STORAGE_BUCKETS`. */
export type BlobStorageBucket =
  | "paper-images"
  | "experiment-artifacts"
  | "vault-assets"
  | "report-images"
  | "log-images";

/** Every bucket a user's blobs live in (the account purge sweeps each one). */
export function blobStorageBuckets(): BlobStorageBucket[] {
  return rawBlobStorageBuckets() as BlobStorageBucket[];
}

// --- storage-config ---
/**
 * Blob storage config and S3 client settings (Rust `storage::config` and
 * `storage::blob_client`), re-exported from index.ts.
 */
export type {
  BlobClientConfig,
  BlobProviderId,
  BlobRuntime,
  ColdFields,
  R2Fields,
  StorageConfig,
};

/** Drops unset (undefined) env values: the wasm side reads only string values. */
function definedEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** Read blob/tiering config from an env bag (undefined values are unset). */
export function readStorageConfig(env: Readonly<Record<string, string | undefined>>): StorageConfig {
  return rawReadStorageConfig(definedEnv(env)) as StorageConfig;
}

// --- sync-adoption-plan ---
/**
 * Adoption rename plan (Rust `sync::adoption_plan`), re-exported from index.ts.
 */
/** A local project as the rename sees it. */
export interface LocalProject {
  id: string;
  name: string;
}

/** One rename to apply: a project, the name it had, and the name it takes. */
export interface Rename {
  id: string;
  from: string;
  to: string;
}

/**
 * The renames adoption needs. `local` must be in name order, as the query returns them.
 */
export function planRenames(
  local: readonly LocalProject[],
  remoteNames: readonly string[],
  deviceLabel: string,
): Rename[] {
  return rawPlanRenames(local, remoteNames, deviceLabel) as Rename[];
}

// --- sync-conflict-attention ---
/**
 * Open-conflict attention rules (Rust `sync::conflict_attention`), re-exported from index.ts.
 */
/** An open conflict as the panel counts it. */
export interface OpenConflictRef {
  kind: string;
  fieldCount: number;
}

/** A field a bulk pick settles, and the side it takes. */
export interface FieldPick {
  field: string;
  side: "local" | "remote";
}

/** How many open conflicts still need a person. */
export function countOpen(open: readonly OpenConflictRef[]): number {
  return rawCountOpen(open);
}

// --- sync-conflict-resolve ---
/**
 * Settling a conflict the reader chose on (Rust `sync::conflict_resolve`). The outbox and
 * `sync_*` SQL stay in TypeScript; these decide the row or the action to run.
 */
/** The row a field-by-field resolution writes: the merge, picks applied, overrides last. */
export function resolveWithRow(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  picks: Record<string, "local" | "remote">,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return rawResolveWithRow(base, local, remote, picks, overrides ?? null) as Record<string, unknown>;
}

// --- sync-device-session ---
/**
 * Which signed-in session drives this device's sync (Rust `sync::device_session`).
 * The device adopts one account; only that account's session runs the loop.
 */
/** What a window does for the session it holds. */
export type SessionAction = "idle" | "adopt" | "drive" | "foreign";

// --- sync-dot ---
/**
 * The account menu's sync dot: state, label and tooltip (Rust `sync::sync_dot`).
 * Timers and the live state stay in TypeScript; the wording and state rules live here.
 */
/** The dot for this state, or `null` when this account does not sync and is online. */
export function syncDot(input: SyncDotInput): SyncDot | null {
  return (rawSyncDot(input) as SyncDot | undefined) ?? null;
}

// --- sync-folder-merge ---
/**
 * Folder merge core, mirror manifest and folder-path helpers (Rust `sync::folder_merge`,
 * `sync::folder_mirror`, `sync::folder_layout`), re-exported from index.ts. Keeps the signatures
 * of apps/web workspace/application/{folder-merge,mirror-manifest,folder-import-apply,remove-project-folder}.ts.
 */
/** A both-changed conflict merged field by field; any other entry, or a missing base or workspace copy, comes back as it was. */
export function mergeBothChanged(
  entry: ImportDiffEntry,
  base: VaultPageBase | undefined,
  workspaceContent: string | undefined,
): ImportDiffEntry {
  return rawMergeBothChanged(entry, base ?? null, workspaceContent) as ImportDiffEntry;
}

/** Previous manifest minus removed paths, plus written paths, deduped in first-seen order. */
export function nextManifest(
  previous: readonly string[],
  run: { written: readonly string[]; removed: readonly string[] },
): string[] {
  return rawNextManifest([...previous], [...run.written], [...run.removed]);
}

// --- sync-panel-labels ---
/**
 * Sync issues panel labels and hunk grouping (Rust `sync::panel_labels`), re-exported from index.ts.
 */
/** A field's choice. `picks` maps a hunk index to the side picked for it. */
export type PanelChoice =
  | { kind: "local" }
  | { kind: "remote" }
  | { kind: "hunks"; picks: Readonly<Record<number, string>> }
  | { kind: "edit"; text: string };

/** Whether a field's choice is complete (an edit with no markers, a pick for every hunk, or a side). */
export function isSettled(choice: PanelChoice | undefined, ours: string, theirs: string): boolean {
  return rawIsSettled(choice, ours, theirs);
}

// --- sync-pglite-sql ---
/**
 * SQL-text helpers for the local PGlite client (Rust `sync::pglite_sql`), re-exported from index.ts.
 */
/** A Postgres array literal; each value is spelled as `String(value)` first. */
export function pgArray(values: readonly unknown[]): string {
  return rawPgArray(values.map((value) => String(value)));
}

// --- sync-phase ---
/**
 * Sync phase rules (Rust `sync::sync_phase`), re-exported from index.ts.
 */
/** The status the sync panel shows. */
export type SyncPhase = "idle" | "offline" | "error";

/** The phase and connectivity a finished or failed cycle leaves behind. */
export interface CyclePhase {
  phase: SyncPhase;
  isOnline: boolean;
}
