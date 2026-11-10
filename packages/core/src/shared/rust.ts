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
import type { Row } from "./three-way-merge.js";
import type { CoreContract } from "./core-contract.js";
import type { PdfLocus, ResolvedAnchor } from "../reader/anchor-shapes.js";
import type { FrontmatterValue, ParsedDocument } from "../workspace/frontmatter.js";
import type { ChangeSide } from "../workspace/change-origin.js";
import type {
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
  fields: Row;
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

export interface RustCoreFns {
  /** Sort key for an annotation: page, then character offset, then distance from the page top. */
  buildAnnotationSortIndex(pageIndex: number, charOffset: number, topPdfUnits: number): string;
  normalizeDoi(doi?: string): string | undefined;
  projectName(name: string): string | undefined;
  resolveTextAnchor(text: string, locus: PdfLocus): ResolvedAnchor | null;

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
  digestText(text: string): string;
  // json data
  jsonDataPath(projectRoot: string, kind: WorkspaceJsonKind): string;
  jsonKindOfPath(path: string): WorkspaceJsonKind | null;
  isAppOwnedPath(path: string): boolean;
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
  imagesOf(metadata: Record<string, unknown> | null | undefined): string[];
  proposalApplies(storedUpdatedAt: string | null | undefined, expectedRevision?: string | null): boolean;
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
  listMembershipByKey(lists: readonly { id: string }[], items: readonly { listId: string; paperId?: string | null; vaultPageId?: string | null }[], key: "paper" | "vaultPage" | "either"): Map<string, Set<string>>;
  /** The vault-relative path, or throws the refusal message. */
  safeRelative(candidate: string): string;
  isLocalZoteroUrl(url: string): boolean;
  formatLogLine(entry: { at: string; level: string; source: string; message: string; detail?: string }): string;
  /** The writes for a new item order, or the message that refuses it. */
  planItemOrder(listId: string, items: readonly ReadingListItem[], orderedIds: readonly string[]): { error?: string | null; writes: { itemId: string; sortOrder: number }[] };
  /** `listId` and every list below it, deepest first. */
  deepestFirstListIds(listId: string, lists: readonly ReadingList[]): string[];
  /** Distinct reviewers of the decisions. */
  reviewers(decisions: readonly ScreeningDecision[]): string[];
  gitReason(text: string): string;
  migratedNotice(raw: string | null): string | null;
  /** Index of the matching project; throws when none or several match. */
  pickProject(projects: readonly { id?: string; name: string; dir: string }[], needle: string | null): number;
}

let core: RustCoreFns | null = null;

export function setRustCore(module: RustCoreFns): void {
  core = module;
}

export function rust(): RustCoreFns & CoreContract {
  if (!core) throw new Error("Rust core not registered yet: the app calls setRustCore() after loading it");
  return core as RustCoreFns & CoreContract;
}
