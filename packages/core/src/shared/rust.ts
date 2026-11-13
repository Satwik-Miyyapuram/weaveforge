/**
 * The Rust core, as packages/core sees it. The app registers the loaded wasm
 * module here (apps/web `lib/rust-core.ts`), and core glue calls Rust through
 * `rust()`, typed from the wasm package's generated declarations.
 */
import type { ConflictKind, ImportAction } from "../workspace/parts-1.js";

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

let core: unknown = null;

export function setRustCore(module: unknown): void {
  core = module;
}

export function rust(): typeof import("@weaveforge/wasm") {
  if (!core) throw new Error("Rust core not registered yet: the app calls setRustCore() after loading it");
  return core as typeof import("@weaveforge/wasm");
}
