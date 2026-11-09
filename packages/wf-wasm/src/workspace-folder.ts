/**
 * Workspace folder mirror: paths, serializing, parsing and diffs (Rust `workspace_folder`), re-exported from index.ts.
 */
import {
  addCounts as rawAddCounts,
  countJsonActions as rawCountJsonActions,
  diffJsonData as rawDiffJsonData,
  diffWorkspace as rawDiffWorkspace,
  entityDir as rawEntityDir,
  idSuffix as rawIdSuffix,
  isAppOwnedPath as rawIsAppOwnedPath,
  jsonDataPath as rawJsonDataPath,
  jsonKindOfPath as rawJsonKindOfPath,
  parseJsonData as rawParseJsonData,
  parseWorkspaceFolder as rawParseWorkspaceFolder,
  planMirror as rawPlanMirror,
  projectDir as rawProjectDir,
  projectMetaDir as rawProjectMetaDir,
  serializeWorkspace as rawSerializeWorkspace,
  stripKindSuffix as rawStripKindSuffix,
  workspaceSnapshotCounts as rawWorkspaceSnapshotCounts,
} from "../pkg/wf_wasm.js";
import type {
  ActionCounts,
  ChangeSide,
  ExistingEntity,
  ImportDiff,
  JsonDiff,
  JsonDiffEntry,
  MirrorResult,
  ParsedEntity,
  ParsedJsonData,
  SerializedAsset,
  SerializedWorkspace,
  WorkspaceEntityType,
  WorkspaceJsonKind,
  WorkspaceSnapshotCounts,
} from "./bindings.js";
import { checkIndexText } from "./text-check.js";

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
