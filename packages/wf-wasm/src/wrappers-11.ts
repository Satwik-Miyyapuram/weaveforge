/**
 * Typed wrappers over the raw wasm exports, folded from 23 one-module files:
 * sync-puller-plan, sync-pump-route, sync-push-plan, sync-send-verdict, tab-groups, text-chunks,
 * theme-config, update-check, url-safety, user-appearance, vault-git-parse, vault-import-links,
 * vault-page, vault-search, vault-template, vector-codec, view-transition, vocab-match,
 * wiki-graph, wiki-index, wiki-pages, wire, workspace-folder-diff.
 */
import {
  applyTemplate as rawApplyTemplate,
  bodyLinksTo as rawBodyLinksTo,
  buildWikiGraph as rawBuildWikiGraph,
  buildWikiIndex as rawBuildWikiIndex,
  checkUrlShape as rawCheckUrlShape,
  chunkForEmbedding as rawChunkForEmbedding,
  classifySend as rawClassifySend,
  continuePushRound as rawContinuePushRound,
  expandEmbeds as rawExpandEmbeds,
  expandIpv6 as rawExpandIpv6,
  extractWikilinks as rawExtractWikilinks,
  graphDegrees as rawGraphDegrees,
  graphDensity as rawGraphDensity,
  groupEligible as rawGroupEligible,
  importableEntities as rawImportableEntities,
  isPlainClick as rawIsPlainClick,
  motionTier as rawMotionTier,
  normalizeAppearance as rawNormalizeAppearance,
  normalizeLengthValue as rawNormalizeLengthValue,
  normalizeThemeConfig as rawNormalizeThemeConfig,
  normalizeTitleKey as rawNormalizeTitleKey,
  noteBacklinks as rawNoteBacklinks,
  parseRegions as rawParseRegions,
  planImportTitles as rawPlanImportTitles,
  pumpRoute as rawPumpRoute,
  replaceVaultAssetPaths as rawReplaceVaultAssetPaths,
  rewriteWikilinks as rawRewriteWikilinks,
  scopeNoteIndices as rawScopeNoteIndices,
  seenFiles as rawSeenFiles,
  shouldFetchNextPage as rawShouldFetchNextPage,
  shouldPullAfterPush as rawShouldPullAfterPush,
  shouldRecoverUnsent as rawShouldRecoverUnsent,
  transitionsOn as rawTransitionsOn,
  uniqueConstraintName as rawUniqueConstraintName,
  uniqueTitle as rawUniqueTitle,
  unpackVectorBlob as rawUnpackVectorBlob,
  unpackVectorHead as rawUnpackVectorHead,
  vaultBodyPreview as rawBodyPreview,
  vaultBodyPreviewChars as rawBodyPreviewChars,
  wikiPageRefs as rawWikiPageRefs,
  wikiSourceDocuments as rawWikiSourceDocuments,
  wireOkReplyHead as rawWireOkReplyHead,
} from "../pkg/wf_wasm.js";
import type {
  ApplyStep,
  ChangeSide,
  ChunkOptions,
  FolderParsedEntity,
  GraphDensity,
  OpenConflictKind,
  OpFact,
  ParsedEntity,
  ParsedFrontmatter,
  PullFacts,
  PullSummary,
  PullSummaryInput,
  RegionKind,
  Segment,
  SeqRow,
  TextChunk,
  ThemeConfig,
  TombstoneStep,
  UrlCheck,
  UserAppearance,
  VectorFileHead,
  VocabMatch,
  VocabMatchResult,
  WikiGraph,
  WikiGraphDegree,
  WikilinkRef,
  WikiNote,
  WikiPageRef,
  WikiPaper,
  WikiSourceDocument,
} from "./bindings.js";

export {
  applyGroupCommand,
  chooseRoot,
  cleanGroups,
  damerauLevenshtein,
  defaultSourceNoteTemplate,
  describeUrlRejection,
  embedTitles,
  fetchLimits,
  findWikiRoot,
  gitNulList,
  gitOverwrittenFiles,
  gitParseLog,
  gitParseStatus,
  gitPathChunks,
  groupRuns,
  importRelativePath,
  isIpAddress,
  isLinkInsert,
  isMarkdownFile,
  isNewerVersion,
  isNoteImportFile,
  isPublicAddress,
  isSearchFile,
  isSkippedDir,
  isTemporaryName,
  isUniqueClash,
  isZipFile,
  looksLikeImageUrl,
  matchVocabulary,
  mergeTemplate,
  missingIds,
  missingPagePlans,
  newestDesktopRelease,
  normalizeColorValue,
  normalizeFontStack,
  normalizeTitleKey,
  noteTags,
  packVectors,
  parseAppVersion,
  parseReleaseTag,
  parseThemeConfig,
  parseWikilinkInner,
  pullApplyStep,
  pullSummary,
  pullTombstoneStep,
  recentlyApprovedWikiPages,
  renameSources,
  renderTemplate,
  replaceWikiIndex,
  rootVerdict,
  searchMatches,
  spanDistance,
  stripFrontmatter,
  stripRegionMarkers,
  substituteVariables,
  tableGroups,
  temporaryName,
  themeConfigTemplate,
  unpackVectorBlob,
  unpackVectorHead,
  vaultAssetPathsInBody,
  vaultBodyPreviewChars,
  vaultImageMarkdown,
  vaultImagePrefix,
  wireErrorReply,
  wireParseRequest,
  wireRoute,
  wireTag,
  withoutGroup,
  withTagLine,
  wrapRegion,
} from "../pkg/wf_wasm.js";
export type {
  ApplyStep,
  FolderParsedEntity,
  NewestRelease,
  OpenConflictKind,
  OpFact,
  PullFacts,
  PullSummary,
  PullSummaryInput,
  RecentWikiPage,
  ReleaseRow,
  SeqRow,
  TombstoneStep,
  WikiNote,
  WikiPagePlanRecord,
  WikiPaper,
  WikiSourceDocument,
} from "./bindings.js";

// --- sync-puller-plan ---
/**
 * Pull decisions for the offline-sync Puller (Rust `sync::puller_plan`), re-exported from
 * index.ts. Summarizes a pull page, picks the apply and tombstone steps, and parses
 * unique-constraint clashes. The shapes come from bindings.ts, generated from the Rust types.
 */
/** The quoted constraint name in a unique-constraint error message, or undefined. */
export function uniqueConstraintName(message: string): string | undefined {
  return rawUniqueConstraintName(message) ?? undefined;
}

// --- sync-pump-route ---
/**
 * Outbox pump routing (Rust `sync::pump_route`), re-exported from modules.ts. Picks the step
 * for one send outcome. Called from `domain/pump.ts`. The types are hand-written here: the
 * serialized forms are the Rust enums in lowercase and the struct fields in camelCase.
 */
/** How the transport answered one send. */
export type PumpSendStatus = "offline" | "accepted" | "conflict" | "refused";

/** The step the pump takes for one op. */
export type PumpRouteAction = "stop" | "settle" | "conflict" | "wait" | "fail";

export interface PumpRouteInput {
  status: PumpSendStatus;
  opIsDelete: boolean;
  hasNewVersion: boolean;
  awaitingParent: boolean;
}

export interface PumpRoute {
  action: PumpRouteAction;
  ack: boolean;
  stall: boolean;
}

/** The route for one send outcome. */
export function pumpRoute(input: PumpRouteInput): PumpRoute {
  return rawPumpRoute(input) as PumpRoute;
}

// --- sync-push-plan ---
/**
 * Push and pull gates for the offline-sync engine (Rust `sync::push_plan`), re-exported from
 * modules.ts. Called from `domain/sync-engine.ts` and `domain/puller.ts`.
 */
/** Whether the push loop runs another round. */
export function continuePushRound(input: { sent: number; stoppedEarly: boolean }): boolean {
  return rawContinuePushRound(input.sent, input.stoppedEarly);
}

/** Whether unsent local rows are checked against the server. */
export function shouldRecoverUnsent(input: { hasAccount: boolean; resendChecked: boolean }): boolean {
  return rawShouldRecoverUnsent(input.hasAccount, input.resendChecked);
}

/** Whether a refused pull may land in a table-wide group. */
export function groupEligible(input: { deleted: boolean; uniqueClash: boolean; pendingOps: number }): boolean {
  return rawGroupEligible(input.deleted, input.uniqueClash, input.pendingOps);
}

/** Whether the pull runs after a push (not when the network stopped the push). */
export function shouldPullAfterPush(input: { stoppedOffline: boolean }): boolean {
  return rawShouldPullAfterPush(input.stoppedOffline);
}

/** Whether the cycle fetches another page; `page` counts the pulls already made. */
export function shouldFetchNextPage(input: { more: boolean; page: number; maxPages: number }): boolean {
  return rawShouldFetchNextPage(input.more, input.page, input.maxPages);
}

// --- sync-send-verdict ---
/**
 * Send verdict and missing-id rules (Rust `sync::send_verdict`), re-exported from index.ts.
 */
/** What one PostgREST write means for the outbox entry. */
export type SendVerdict =
  | "awaiting_parent"
  | "conflict"
  | "offline"
  | "rls_refused"
  | "refused"
  | "guard_missed"
  | "accepted";

/**
 * The verdict for one write. `errorCode` is the Postgres code from the body, or null.
 * `rows` is how many rows a guarded write returned, or null when the body was not an array.
 */
export function classifySend(status: number, errorCode: string | null, rows: number | null): SendVerdict {
  return rawClassifySend(status, errorCode, rows) as SendVerdict;
}

// --- tab-groups ---
/**
 * Tab groups (Rust `editor_workspace::tab_groups`), re-exported from index.ts.
 */

/** The colours a group can take (Rust `GROUP_COLORS`). */
export const GROUP_COLORS = [1, 2, 3, 4, 5, 6] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

// --- text-chunks ---
/**
 * Splitting a document into passages an encoder can read (Rust `text_chunks`), re-exported from index.ts.
 * Keeps the signature of the old TS module (removed; its types now live in packages/core/src/shared/core-contract.ts).
 */
export function chunkForEmbedding(text: string, options: ChunkOptions = {}): TextChunk[] {
  return rawChunkForEmbedding(text, options) as TextChunk[];
}

// --- theme-config ---
/**
 * Theme config parsing (Rust `settings::theme_config`), re-exported from index.ts. Keeps the
 * signatures of packages/core/src/features/settings/domain/parts.ts.
 * Types come from ./bindings.ts.
 */
/** Lengths such as `12px`, `0.5rem` or a px number, limited to `maxPx`; null otherwise. */
export function normalizeLengthValue(raw: unknown, maxPx = 64): string | null {
  return rawNormalizeLengthValue(raw, maxPx) ?? null;
}

/** A stored config re-checked as if uploaded again; null when it no longer passes. */
export function normalizeThemeConfig(raw: unknown): ThemeConfig | null {
  // Plain JSON only, as the TS copy rebuilds it through JSON.stringify.
  const plain: unknown = JSON.parse(JSON.stringify(raw) ?? "null");
  return rawNormalizeThemeConfig(plain) as ThemeConfig | null;
}

// --- update-check ---
/**
 * Desktop update check (Rust `update_check`), re-exported from index.ts. The types mirror the Rust
 * structs; they are not in bindings.ts yet.
 */
/** A version as three numbers, `[major, minor, patch]`. */
export type AppVersion = [number, number, number];

// --- url-safety ---
/**
 * Outbound URL and address checks (Rust `url_safety`), re-exported from index.ts.
 * Each function keeps the signature of UrlSafetyFns in packages/core/src/shared/core-contract.ts.
 * URL parsing stays here (WHATWG `URL`); only the pure checks run in Rust.
 */
/**
 * Parses a URL, accepting a scheme-less host the way a person would type it.
 */
export function parseUserUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/** Decides from the URL alone whether it may be fetched. */
export function checkUrlShape(input: string | URL): UrlCheck {
  const url = typeof input === "string" ? parseUserUrl(input) : input;
  if (!url) return { ok: false, reason: "not-a-url" };
  return rawCheckUrlShape(
    url.protocol,
    Boolean(url.username || url.password),
    url.port,
    url.hostname,
  ) as UrlCheck;
}

/** Expands an IPv6 address to its eight groups, or null when it is not one. */
export function expandIpv6(value: string): number[] | null {
  return (rawExpandIpv6(value) as number[] | undefined) ?? null;
}

// --- user-appearance ---
/**
 * Appearance preferences (Rust `settings::user_appearance`), re-exported from index.ts.
 * Keeps the signatures of packages/core/src/features/settings/domain/parts.ts.
 * Types come from ./bindings.ts.
 */
/** Plain JSON only, as the stored row is JSON. */
function plain(raw: unknown): unknown {
  return raw === undefined ? undefined : JSON.parse(JSON.stringify(raw) ?? "null");
}

/** The valid appearance preferences of a stored value; undefined when none are. */
export function normalizeAppearance(raw: unknown): UserAppearance | undefined {
  return (rawNormalizeAppearance(plain(raw)) ?? undefined) as UserAppearance | undefined;
}

// --- vault-git-parse ---
/**
 * Git text output parsers (Rust `sync::vault_git_parse`), re-exported from feature-wrappers.ts.
 * Keeps running git and reading its stdout in apps/shell/sidecar/src/vault-git.ts.
 */
export interface ParsedGitFileStatus {
  /** Path relative to the repository root. */
  path: string;
  state: "deleted" | "added" | "modified";
}

export interface ParsedGitLogCommit {
  /** Full commit id. */
  oid: string;
  /** Author date as git prints it. */
  authoredAt: string;
  /** Author name. */
  author: string;
  /** Subject and body, rejoined with the field separator. */
  message: string;
}

// --- vault-import-links ---
/**
 * Notes import helpers (Rust `vault::import_links`), re-exported from index.ts: the wikilink
 * rewrite after titles are auto-suffixed, and the file-name filter for an import.
 */
/** The titles an import gives its folders and notes, and the renames it made. */
export interface ImportTitlePlan {
  /** One title per folder key, in the order given. */
  readonly folderTitles: readonly string[];
  /** One title per note name, in the order given. */
  readonly noteTitles: readonly string[];
  /** Folders first, then notes, each whose title differs from its base name. */
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  /** Normalised base name to new title, for `rewriteWikilinks`. */
  readonly renameMap: ReadonlyMap<string, string>;
}

/** Decides the import titles for folder keys and note names against the existing titles. */
export function planImportTitles(
  folderKeys: readonly string[],
  noteNames: readonly string[],
  existingTitles: readonly string[],
): ImportTitlePlan {
  const raw = rawPlanImportTitles([...folderKeys], [...noteNames], [...existingTitles]);
  return {
    folderTitles: raw.folderTitles,
    noteTitles: raw.noteTitles,
    renamed: raw.renamed,
    renameMap: new Map(Object.entries(raw.renameMap)),
  };
}

/**
 * Rewrite `[[Old]]`, `[[Old|alias]]` and `[[Old#heading]]` when import renamed `Old`. `renames`
 * maps a normalised old title to its new title.
 */
export function rewriteWikilinks(body: string, renames: ReadonlyMap<string, string>): string {
  return rawRewriteWikilinks(body, Object.fromEntries(renames));
}

// --- vault-page ---
/**
 * Typed wrappers over the wasm vault page helpers (wf-core `vault::page`). The names and
 * defaults match the `VaultPage` contract in `packages/core/src/shared/core-contract.ts`; the
 * markdown image helpers live in `workspace.ts`.
 */
export type { ParsedFrontmatter, WikilinkRef };

export function extractWikilinks(body?: string): WikilinkRef[] {
  if (!body) return [];
  return rawExtractWikilinks(body) as WikilinkRef[];
}

export function bodyLinksTo(body: string | undefined, targetKey: string): boolean {
  if (!body) return false;
  return rawBodyLinksTo(body, targetKey);
}

/** A title unique against `used` (normalized keys). Records the chosen key in `used`, as TS does. */
export function uniqueTitle(base: string, used: Set<string>): string {
  const title = rawUniqueTitle(base, [...used]);
  used.add(rawNormalizeTitleKey(title));
  return title;
}

export function vaultBodyPreview(body: string, max = rawBodyPreviewChars()): string {
  if (!body) return "";
  return rawBodyPreview(body, max);
}

/** `body` with each embed whose title is in `resolved` replaced by that note's body as a callout. */
export function expandEmbeds(body: string, resolved: ReadonlyMap<string, string>): string {
  return rawExpandEmbeds(body, [...resolved.keys()], [...resolved.values()]);
}

/** `body` with each `vault:{oldPath}` rewritten to `vault:{newPath}`, in order. */
export function replaceVaultAssetPaths(
  body: string,
  rewrites: readonly { oldPath: string; newPath: string }[],
): string {
  return rawReplaceVaultAssetPaths(
    body,
    rewrites.map((r) => r.oldPath),
    rewrites.map((r) => r.newPath),
  );
}

/** The other notes whose body links to `selectedId`'s title, as `{ id, title }`. */
export function noteBacklinks(
  notes: readonly unknown[],
  selectedId?: string,
): { id: string; title: string }[] {
  return rawNoteBacklinks(notes, selectedId);
}

/** Positions of the notes kept by a list and tag filter. An empty filter keeps everything. */
export function scopeNoteIndices(
  notes: readonly unknown[],
  listFilter: readonly string[],
  tagFilter: readonly string[],
  membership: Readonly<Record<string, readonly string[]>>,
): number[] {
  return rawScopeNoteIndices(notes, [...listFilter], [...tagFilter], membership);
}

// --- vault-search ---
/**
 * Vault folder and search rules (Rust `vault_search`), re-exported from index.ts. Walks, reads, realpath and
 * mkdir stay in TypeScript.
 */

export type RootVerdict = "notADirectory" | "existing" | "empty" | "notEmpty";
export type RootChoice = "use" | "nest" | "refuse";

// --- vault-template ---
/**
 * The vault note template engine (Rust `vault::template`), re-exported from index.ts.
 * Templates use `{{var}}` substitution and region markers; see the Rust module docs.
 */
export type { RegionKind, Segment };

/** Text / region segments, or `{ ok: false }` when any marker is damaged. */
export function parseRegions(
  document: string,
): { ok: true; segments: Segment[] } | { ok: false; reason: "malformed_markers" } {
  return rawParseRegions(document) as { ok: true; segments: Segment[] } | { ok: false; reason: "malformed_markers" };
}

/**
 * First render (empty or whitespace-only `existing`) or merge on re-render.
 */
export function applyTemplate(
  existing: string | null | undefined,
  template: string,
  context: Record<string, unknown>,
): string {
  return rawApplyTemplate(existing ?? null, template, context);
}

// --- vector-codec ---
/**
 * The stored vector file's framing (Rust `search::vector_codec`): a length-prefixed
 * JSON head, then the vector blob.
 */
export type { VectorFileHead };

/** A file's head and blob, or `null` if it is torn or its head is not valid. */
export function unpackVectors(file: Uint8Array): (VectorFileHead & { bytes: Uint8Array }) | null {
  const head = rawUnpackVectorHead(file);
  const bytes = rawUnpackVectorBlob(file);
  if (head === null || bytes === undefined) return null;
  return { ...head, bytes };
}

// --- view-transition ---
/**
 * Page-transition tier and click checks (Rust `view_transition`), re-exported from index.ts.
 */
export type MotionTier = "off" | "calm" | "reactive" | "crt";
export type MotionTierInput = { motion: string | undefined; theme: string | undefined; reducedMotion: boolean; supported: boolean };

/** Calm by default, bigger with Reactive motion, stepped on CRT; off when reduced or unsupported (Rust `motion_tier`). */
export function motionTier(input: MotionTierInput): MotionTier {
  return rawMotionTier(input.motion, input.theme, input.reducedMotion, input.supported) as MotionTier;
}

/** True when the tier animates at all (Rust `transitions_on`). */
export function transitionsOn(input: MotionTierInput): boolean {
  return rawTransitionsOn(input.motion, input.theme, input.reducedMotion, input.supported);
}

/** The mouse fields a link click is judged by. */
export type ClickFields = {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** A plain left click that a link would follow in this window (Rust `is_plain_click`). */
export function isPlainClick(e: ClickFields): boolean {
  return rawIsPlainClick(e.button, e.defaultPrevented, e.metaKey, e.ctrlKey, e.shiftKey, e.altKey);
}

// --- vocab-match ---
/**
 * Near-miss vocabulary matching for recognised ink text (Rust
 * `ink::vocab_match`), re-exported from index.ts.
 */
export type { VocabMatch, VocabMatchResult };

// --- wiki-graph ---
/**
 * Wiki-link graph (Rust `search::wiki_graph`), re-exported from index.ts. Each function keeps the
 * signature of packages/core/src/search/parts.ts. The wasm side sends `edges` as an array of
 * `{ node, neighbours }` rows, so these wrappers convert to and from the TS `Map` form.
 */
/** Build the graph: nodes `kind:id`, undirected adjacency in insertion order. */
export function buildWikiGraph(snapshot: object): {
  nodes: string[];
  edges: Map<string, string[]>;
} {
  const wire: WikiGraph = rawBuildWikiGraph(snapshot);
  return {
    nodes: wire.nodes,
    edges: new Map(wire.edges.map((entry): [string, string[]] => [entry.node, entry.neighbours])),
  };
}

/** Link count per node, for `SearchDoc.degree`. */
export function graphDegrees(graph: {
  nodes: string[];
  edges: Map<string, string[]>;
}): Map<string, number> {
  const wire: WikiGraph = {
    nodes: [...graph.nodes],
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours: [...neighbours] })),
  };
  const rows: WikiGraphDegree[] = rawGraphDegrees(wire);
  return new Map(rows.map((row): [string, number] => [row.node, row.degree ?? 0]));
}

/** Measure the graph: node and edge counts, mean degree, largest component share. */
export function graphDensity(graph: {
  nodes: string[];
  edges: Map<string, string[]>;
}): GraphDensity {
  const wire: WikiGraph = {
    nodes: [...graph.nodes],
    edges: [...graph.edges].map(([node, neighbours]) => ({ node, neighbours: [...neighbours] })),
  };
  return rawGraphDensity(wire) as GraphDensity;
}

// --- wiki-index ---
/**
 * Wiki index (Rust `ai::wiki_index`), re-exported from index.ts. Each function keeps the
 * signature of packages/core/src/features/ai-assistant/domain/wiki-index.ts.
 */
/** Marks the generated region so a rebuild never eats hand-written text. */
export const INDEX_MARKER_START = "<!-- weaveforge:wiki-index -->";
export const INDEX_MARKER_END = "<!-- /weaveforge:wiki-index -->";

/** Build the generated block. `now` is read only when pages exist, as in the TS original. */
export function buildWikiIndex(
  pages: readonly WikiPageRef[],
  options: { heading?: string; now?: () => string } = {},
): string {
  const generatedAt = pages.length > 0 ? (options.now ?? (() => new Date().toISOString()))() : "";
  return rawBuildWikiIndex(pages, options.heading, generatedAt);
}

// --- wiki-pages ---
/**
 * Wiki build rules (Rust `ai::wiki_pages`): which notes are wiki pages, extraction
 * documents, page refs, dead-link page plans and recently written pages. The web
 * adapter in `apps/web/.../wiki/application/wiki-build.ts` does the reads and proposals.
 */
/**
 * The wiki's pages (children of the root) as `{ id, title, body, aliases? }`.
 *
 * Typed locally: the bindings name `WikiPageRef` belongs to the wiki-index shape
 * (`title`, `aliases`), not this lint shape. `aliases` is `undefined`, never `null`.
 */
export type WikiLintPageRef = { id: string; title: string; body: string; aliases?: string[] };

export function wikiPageRefs(pages: readonly WikiNote[]): WikiLintPageRef[] {
  const raw = rawWikiPageRefs(pages) as Array<WikiLintPageRef & { aliases?: string[] | null }>;
  return raw.map(({ aliases, ...page }) => (aliases ? { ...page, aliases } : page));
}

/** Notes (not generated pages) and papers as extraction documents; `sourceIds` restricts them. */
export function wikiSourceDocuments(
  pages: readonly WikiNote[],
  papers: readonly WikiPaper[],
  sourceIds?: readonly string[],
): WikiSourceDocument[] {
  return rawWikiSourceDocuments(pages, papers, sourceIds ? [...sourceIds] : undefined) as WikiSourceDocument[];
}

// --- wire ---
/**
 * Sidecar wire rules (Rust `wire`): request and answer lines, the one-key
 * tagged values, and the reply shapes. Sockets, readline, ask timers and the
 * handler table stay in `apps/shell/sidecar/src/wire.ts`.
 */
/** What to do with one line read from the shell. */
export type WireRoute =
  | { kind: "skip" }
  | { kind: "reply"; reply: Record<string, unknown> }
  | { kind: "call"; id: number; method: string; params?: unknown }
  | { kind: "settle"; answer: number; ok: true; value: unknown }
  | { kind: "settle"; answer: number; ok: false; error: string }
  | { kind: "badAnswer" };

/** A request line read on its own. */
export type WireParsed =
  | { ok: true; id: number; method: string; params?: unknown }
  | { ok: false; error: string };

/** A one-key tagged value, or `null` when the value is not a tag. */
export type WireTagValue =
  | { kind: "bigint"; digits: string }
  | { kind: "bytes"; encoded: string }
  | null;

/** The start of a successful reply: `{id, ok: true}`. The shim adds `value`. */
export function wireOkReplyHead(id: number): { id: number; ok: true } {
  return rawWireOkReplyHead(id) as { id: number; ok: true };
}

// --- workspace-folder-diff ---
/**
 * Folder-diff helpers (Rust `workspace::folder_diff`): renames of note files in the
 * connected folder, and what each folder file said since the sides last agreed.
 */
/** What one folder file said: who moved it since the sides last agreed, and its digest now. */
export interface FolderSeenFile {
  side: ChangeSide;
  digest: string;
  newPath?: boolean;
  renamedFrom?: string;
}

/** The folder files a folder import may bring in: vault pages, and files whose note id is in `noteIds`. */
export function importableEntities(
  entities: readonly ParsedEntity[],
  noteIds: ReadonlySet<string>,
): ParsedEntity[] {
  return rawImportableEntities(entities, [...noteIds]) as ParsedEntity[];
}

/** Who moved each folder file since the two sides last agreed, keyed by path. */
export function seenFiles(
  folder: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>>,
  renamed: Readonly<Record<string, string>>,
): Record<string, FolderSeenFile> {
  return rawSeenFiles(folder, current, base, renamed) as Record<string, FolderSeenFile>;
}
