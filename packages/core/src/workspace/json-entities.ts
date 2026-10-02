/**
 * The project's JSON data files, two-way like the markdown.
 *
 * `relations.json`, `tags.json` and `reading-list-items.json` hold data with no
 * natural prose form, which is why they are JSON rather than markdown — but that
 * is a fact about their shape, not about who may edit them. A person can add an
 * edge, rename a tag or drop a paper from a list in the folder, and the import
 * brings it back the way it brings back an edited note.
 *
 * The one asymmetry is the mirror's own record: `mirror.json` and
 * `manifest.json` are what the app wrote, and importing them would be the app
 * reading its own notes back to itself. They are skipped, along with the
 * database, its backups and the search cache.
 *
 * Pure: parsing and comparing only. The caller reads the files and applies the
 * result, which is what keeps this testable without a container.
 */

import type { ChangeSide } from "./change-origin.js";
import type { ConflictKind, ImportAction } from "./deserialize-workspace.js";
import { WORKSPACE_META_DIR, projectMetaDir } from "./folder-layout.js";

export type WorkspaceJsonKind = "relations" | "tags" | "reading_list_items";

/** The file each kind is written to. */
export const JSON_KIND_FILE: Record<WorkspaceJsonKind, string> = {
  relations: "relations.json",
  tags: "tags.json",
  reading_list_items: "reading-list-items.json",
};

/**
 * The three, in the order the mirror writes them.
 *
 * Membership is last because it is the only one whose rows cannot exist without
 * the other two: a paper in a list refers to a list.
 */
export const JSON_KINDS: readonly WorkspaceJsonKind[] = ["relations", "tags", "reading_list_items"];

/** `<project>/.weaveforge/relations.json` */
export function jsonDataPath(projectRoot: string, kind: WorkspaceJsonKind): string {
  return `${projectMetaDir(projectRoot)}/${JSON_KIND_FILE[kind]}`;
}

/** The kind a path names, or null when it is not one of the three. */
export function jsonKindOfPath(path: string): WorkspaceJsonKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  for (const kind of JSON_KINDS) {
    if (JSON_KIND_FILE[kind] === name) return kind;
  }
  return null;
}

/** Directories under a `.weaveforge/` that are the app's own and never data. */
const MACHINERY_DIRS = new Set(["db", "db-backups", "cache"]);
/** Files that are the app's record of what it wrote, never something to import. */
const MACHINERY_FILES = new Set(["mirror.json", "manifest.json"]);

/**
 * Whether a changed folder path is the app's own machinery.
 *
 * A file the app rewrites as part of doing its job — the database, its backups,
 * the search cache, the mirror's manifest — is not an edit to report or import.
 * Everything else in the folder is the reader's, including the three JSON files
 * this module is about: those are data the app happens to store as JSON.
 */
export function isAppOwnedPath(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "";
  // The folder's git history and its root README are written by the mirror itself.
  if (parts.includes(".git") || path === "README.md") return true;
  const metaAt = parts.lastIndexOf(WORKSPACE_META_DIR);
  if (metaAt >= 0 && MACHINERY_DIRS.has(parts[metaAt + 1] ?? "")) return true;
  if (MACHINERY_FILES.has(name)) return true;
  // Anything else sitting directly in a `.weaveforge/` is the app's bookkeeping
  // too — a relocation marker, a scratch file — but the three data files are
  // the exception, and they are what this module exists for.
  if (metaAt >= 0 && parts.length === metaAt + 2 && jsonKindOfPath(path) === null) return true;
  return false;
}

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

/**
 * Read one of the three files.
 *
 * Null when the file is not a JSON array of objects with ids: a truncated write,
 * a hand-made file of a different shape, a `.json` from somewhere else. Null
 * means "say nothing about this file" rather than "it is empty" — reporting an
 * unreadable file as a removal of everything would be the one destructive
 * reading of a syntax error.
 */
export function parseJsonData(
  path: string,
  content: string,
  kind: WorkspaceJsonKind,
): ParsedJsonData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const rows: JsonRow[] = [];
  for (const row of parsed) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string" || !id) continue;
    rows.push(row as JsonRow);
  }
  return { kind, path, rows };
}

export interface JsonDiffEntry {
  action: ImportAction;
  kind: WorkspaceJsonKind;
  path: string;
  /**
   * The row as the folder has it. Absent on a removal, where the row is the one
   * the file stopped listing.
   */
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

export interface JsonDiffOptions {
  /**
   * Who changed the file, from the mirror's recorded digest. Optional for the
   * same reason the markdown diff's is: a folder the app never wrote has no
   * base, and then every difference is the reader's to judge.
   */
  origin?(path: string): ChangeSide;
}

/** Two rows are the same row when every field the file carries matches. */
function sameRow(a: JsonRow, b: JsonRow): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}

/**
 * Compare one file's rows against what is stored, by id.
 *
 * The rules are the markdown import's, because they are the same question:
 *
 * - an id nothing has is a creation (whatever it says, it cannot overwrite),
 * - a row that matches is unchanged,
 * - a row that differs is an update when the folder moved it, unchanged when the
 *   workspace did, and a conflict when both did,
 * - a stored row the file no longer lists is a removal — reported, counted, and
 *   applied only when the reader agrees, which is what makes a truncated file a
 *   question rather than a deletion.
 */
export function diffJsonData(
  parsed: ParsedJsonData,
  existing: readonly JsonRow[],
  options: JsonDiffOptions = {},
): JsonDiff {
  const byId = new Map(existing.map((row) => [row.id, row]));
  const entries: JsonDiffEntry[] = [];

  for (const row of parsed.rows) {
    const current = byId.get(row.id);
    if (!current) {
      entries.push({ action: "created", kind: parsed.kind, path: parsed.path, row, existing: row });
      continue;
    }
    if (sameRow(row, current)) {
      entries.push({ action: "unchanged", kind: parsed.kind, path: parsed.path, row, existing: current });
      continue;
    }

    const side = options.origin?.(parsed.path) ?? "unknown";
    if (side === "workspace") {
      entries.push({ action: "unchanged", kind: parsed.kind, path: parsed.path, row, existing: current });
      continue;
    }
    if (side === "both") {
      entries.push({
        action: "conflict",
        kind: parsed.kind,
        path: parsed.path,
        row,
        existing: current,
        conflictKind: "both-changed",
        reason: `${parsed.path} changed both in the folder and in the workspace since they last agreed.`,
      });
      continue;
    }
    entries.push({ action: "updated", kind: parsed.kind, path: parsed.path, row, existing: current });
  }

  const listed = new Set(parsed.rows.map((row) => row.id));
  for (const current of existing) {
    if (listed.has(current.id)) continue;
    entries.push({ action: "removed", kind: parsed.kind, path: parsed.path, existing: current });
  }

  return { entries, counts: countJsonActions(entries) };
}

/** The same four numbers the markdown import shows, plus removals. */
export function countJsonActions(entries: readonly JsonDiffEntry[]): Record<ImportAction, number> {
  const counts: Record<ImportAction, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    removed: 0,
  };
  for (const entry of entries) counts[entry.action] += 1;
  return counts;
}

/** Sum two sets of counts, for one preview showing both halves. */
export function addCounts(
  a: Readonly<Record<ImportAction, number>>,
  b: Readonly<Record<ImportAction, number>>,
): Record<ImportAction, number> {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    conflict: a.conflict + b.conflict,
    removed: a.removed + b.removed,
  };
}

export const EMPTY_JSON_DIFF: JsonDiff = {
  entries: [],
  counts: { created: 0, updated: 0, unchanged: 0, conflict: 0, removed: 0 },
};
