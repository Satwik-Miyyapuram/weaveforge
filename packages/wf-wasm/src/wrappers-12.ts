/**
 * Typed wrappers over the raw wasm exports, folded from 5 one-module files:
 * user-integration-credentials, workspace-folder, workspace-outside-edits, workspace-tree,
 * zotero-library.
 */
import {
  diffJsonData as rawDiffJsonData,
  diffWorkspace as rawDiffWorkspace,
  filterRows as rawFilterRows,
  folderIdsOf as rawFolderIdsOf,
  getUserIntegrationField as rawGetUserIntegrationField,
  integrationsBagFromLegacy as rawIntegrationsBagFromLegacy,
  isUserIntegrationConnected as rawIsUserIntegrationConnected,
  listMembership as rawListMembership,
  normalizeZoteroLibrary as rawNormalizeZoteroLibrary,
  parseWorkspaceFolder as rawParseWorkspaceFolder,
  planMirror as rawPlanMirror,
  projectDir as rawProjectDir,
  renamedOutsidePaths as rawRenamedOutsidePaths,
  serializeWorkspace as rawSerializeWorkspace,
  splitOutsideEdits as rawSplitOutsideEdits,
  treePathPairs as rawTreePathPairs,
  visibleRows as rawVisibleRows,
  workspaceSnapshotCounts as rawWorkspaceSnapshotCounts,
} from "../pkg/wf_wasm.js";
import type {
  ChangeSide,
  CredentialSettings,
  ExistingEntity,
  HeldReason,
  ImportDiff,
  JsonDiff,
  ListItemEntry,
  MirrorResult,
  OutsideEditSplit,
  OutsideNoteEntry,
  OutsideRowEntry,
  ParsedEntity,
  ParsedJsonData,
  SerializedAsset,
  SerializedWorkspace,
  VisibleRow,
  WorkspaceEntityType,
  WorkspaceSnapshotCounts,
  WorkspaceTreeNode,
} from "./bindings.js";

export {
  addCounts,
  buildListsTree,
  buildWorkspaceTree,
  checkGitRemoteUrl,
  countJsonActions,
  entityDir,
  flattenTree,
  folderKey,
  folderKeys,
  idSuffix,
  isAppOwnedPath,
  isDocumentNode,
  isZoteroChildItem,
  jsonDataPath,
  jsonKindOfPath,
  parseJsonData,
  projectMetaDir,
  slugFor,
  slugSegment,
  stripKindSuffix,
  zoteroHeaders,
  zoteroLibraryUrl,
  zoteroTopLevelPath,
} from "../pkg/wf_wasm.js";
export type {
  HeldReason,
  OutsideEditSplit,
  OutsideNoteEntry,
  OutsideRowEntry,
} from "./bindings.js";

// --- user-integration-credentials ---
/**
 * Provider credential helpers (Rust `settings::integration_credentials`), re-exported from index.ts.
 * Keep the signatures of packages/core/src/features/settings/domain/user-integration-credentials.ts.
 * Types come from ./bindings.ts.
 */
const LEGACY_FIELDS = ["zoteroApiKey", "zoteroLibrary", "semanticScholarKey"];

/**
 * Plain JSON only, as the stored row is JSON. TS reads legacy columns only when they are
 * strings and treats null bag entries as missing, so drop those before Rust sees them.
 */
function plain(raw: unknown): unknown {
  const value: unknown = JSON.parse(JSON.stringify(raw) ?? "null");
  if (value === null || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  for (const key of LEGACY_FIELDS) {
    if (typeof row[key] !== "string") delete row[key];
  }
  const bags = row.integrations;
  if (bags === null) delete row.integrations;
  else if (typeof bags === "object" && !Array.isArray(bags)) {
    const byProvider = bags as Record<string, unknown>;
    for (const [provider, bag] of Object.entries(byProvider)) {
      if (bag === null) delete byProvider[provider];
      else if (typeof bag === "object" && !Array.isArray(bag)) {
        const fields = bag as Record<string, unknown>;
        for (const [field, v] of Object.entries(fields)) if (v === null) delete fields[field];
      }
    }
  }
  return row;
}

/** Read a provider field from the integrations bag or legacy flat columns. */
export function getUserIntegrationField(
  settings: CredentialSettings,
  providerId: string,
  fieldId: string,
): string | undefined {
  return (rawGetUserIntegrationField(plain(settings), providerId, fieldId) ?? undefined) as
    | string
    | undefined;
}

/** True when the provider has at least one non-empty credential field. */
export function isUserIntegrationConnected(
  settings: CredentialSettings,
  providerId: string,
  fieldIds: readonly string[],
): boolean {
  return rawIsUserIntegrationConnected(plain(settings), providerId, [...fieldIds]);
}

/** Build integrations bag from legacy flat columns (for reads after migration). */
export function integrationsBagFromLegacy(
  settings: CredentialSettings,
): Record<string, Record<string, string>> | undefined {
  return (rawIntegrationsBagFromLegacy(plain(settings)) ?? undefined) as
    | Record<string, Record<string, string>>
    | undefined;
}

// --- workspace-folder ---
/**
 * Workspace folder mirror: paths, serializing, parsing and diffs (Rust `workspace_folder`), re-exported from index.ts.
 */
/** The folder of a project, named from its id and name (Rust `project_dir`). */
export function projectDir(project: { id: string; name: string }): string {
  return rawProjectDir(project.id, project.name);
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

/** What importing a JSON data file would do to the stored rows (Rust `diff_json_data`). */
export function diffJsonData(
  parsed: ParsedJsonData,
  existing: readonly Readonly<Record<string, unknown>>[],
  options: { origin?(path: string): ChangeSide } = {},
): JsonDiff {
  return rawDiffJsonData(parsed, JSON.stringify(existing), options.origin?.(parsed.path)) as JsonDiff;
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

/** The folder path of each node in a tree, keyed by id. */
export function treePaths(
  nodes: readonly { id: string; title: string; parentId?: string | null }[],
  type: WorkspaceEntityType,
  projectRoot = "",
): Map<string, string> {
  return new Map(rawTreePathPairs([...nodes], type, projectRoot) as [string, string][]);
}

/** `[id, path]` pairs for each node in a tree (Rust `tree_paths`). */
export function treePathPairs(
  nodes: readonly { id: string; title: string; parentId?: string | null }[],
  type: WorkspaceEntityType,
  projectRoot = "",
): [string, string][] {
  return rawTreePathPairs([...nodes], type, projectRoot) as [string, string][];
}

// --- workspace-outside-edits ---
/**
 * Outside-edit triage (Rust `workspace::outside_edits`). Decides which changes made in
 * the connected folder are taken in without asking, and why the rest wait for review.
 */
/** What the preview saw of one folder file. */
export interface OutsideSeenFile {
  side: ChangeSide;
  newPath?: boolean;
  renamedFrom?: string;
}

/** Held flags for notes and rows, and the first reason per held path. */
export function splitOutsideEdits(input: {
  notes: OutsideNoteEntry[];
  rows: OutsideRowEntry[];
  seen: Readonly<Record<string, OutsideSeenFile>>;
}): OutsideEditSplit {
  return rawSplitOutsideEdits(input) as OutsideEditSplit;
}

/** Paths of renamed notes among `paths`, in order and without repeats. */
export function renamedOutsidePaths(
  seen: Readonly<Record<string, OutsideSeenFile>>,
  paths: readonly string[],
): string[] {
  return rawRenamedOutsidePaths(seen, [...paths]) as string[];
}

// --- workspace-tree ---
/**
 * Explorer tree (Rust `editor_workspace::workspace_tree`), re-exported from index.ts.
 * The raw exports take and return arrays and plain objects; the Set and Map
 * results are built here.
 */
export function folderIdsOf(nodes: readonly WorkspaceTreeNode[]): Set<string> {
  return new Set(rawFolderIdsOf(nodes) as string[]);
}

export function visibleRows(
  nodes: readonly WorkspaceTreeNode[],
  expanded: ReadonlySet<string>,
): VisibleRow[] {
  return rawVisibleRows(nodes, [...expanded]) as VisibleRow[];
}

export function listMembership(
  items: readonly ListItemEntry[],
  titles: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const membership = rawListMembership(items, Object.fromEntries(titles)) as Record<string, string[]>;
  return new Map(Object.entries(membership));
}

export function filterRows(
  rows: readonly VisibleRow[],
  query: string,
): { rows: VisibleRow[]; expand: Set<string> } {
  const raw = rawFilterRows(rows, query) as { rows: VisibleRow[]; expand: string[] };
  return { rows: raw.rows, expand: new Set(raw.expand) };
}

// --- zotero-library ---
/**
 * Zotero Web API library helpers (Rust `zotero_library`), re-exported from index.ts.
 * Keeps the results of the helpers in apps/web/src/features/papers/infrastructure/zotero-web-api.ts.
 */
/** The library path for a pasted library id or path, or undefined when it is not one. */
export function normalizeZoteroLibrary(library: string | undefined): string | undefined {
  return (rawNormalizeZoteroLibrary(library) as string | null) ?? undefined;
}
