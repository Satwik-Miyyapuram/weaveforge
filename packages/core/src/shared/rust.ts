/**
 * The Rust core, as packages/core sees it. This package cannot import the wasm
 * package, so the app registers the loaded module here (apps/web
 * `lib/rust-core.ts`), and core glue calls Rust through `rust()`.
 *
 * `RustCoreFns` lists only the functions core glue or core tests call. Add a line
 * when a core file starts calling a new one: the app's `setRustCore(module)` call
 * fails to typecheck if the wasm module does not export it with that signature.
 */
import type { Row } from "./three-way-merge.js";
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

export interface RustCoreFns {
  normalizeDoi(doi?: string): string | undefined;
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
}

let core: RustCoreFns | null = null;

export function setRustCore(module: RustCoreFns): void {
  core = module;
}

export function rust(): RustCoreFns {
  if (!core) throw new Error("Rust core not registered yet: the app calls setRustCore() after loading it");
  return core;
}
