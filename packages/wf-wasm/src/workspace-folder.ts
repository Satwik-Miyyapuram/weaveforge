/**
 * Workspace folder mirror: paths, serializing, parsing and diffs (Rust `workspace_folder`), re-exported from index.ts.
 */
import {
  treePathPairs as rawTreePathPairs,
  diffJsonData as rawDiffJsonData,
  diffWorkspace as rawDiffWorkspace,
  parseWorkspaceFolder as rawParseWorkspaceFolder,
  planMirror as rawPlanMirror,
  projectDir as rawProjectDir,
  serializeWorkspace as rawSerializeWorkspace,
  workspaceSnapshotCounts as rawWorkspaceSnapshotCounts,
} from "../pkg/wf_wasm.js";
import type {
  ChangeSide,
  ExistingEntity,
  ImportDiff,
  JsonDiff,
  MirrorResult,
  ParsedEntity,
  ParsedJsonData,
  SerializedAsset,
  SerializedWorkspace,
  WorkspaceEntityType,
  WorkspaceSnapshotCounts,
} from "./bindings.js";

export {
  countJsonActions,
  entityDir,
  idSuffix,
  isAppOwnedPath,
  jsonDataPath,
  projectMetaDir,
  stripKindSuffix,
} from "../pkg/wf_wasm.js";

export {
  addCounts,
  checkGitRemoteUrl,
  folderKey,
  folderKeys,
  jsonKindOfPath,
  parseJsonData,
  slugFor,
} from "../pkg/wf_wasm.js";

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
