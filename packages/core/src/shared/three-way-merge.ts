/**
 * Three-way merge, per field.
 *
 * Per-field and not per-row, because one device renaming a paper while the
 * other marks it read is not a disagreement, and a design that reports it as
 * one gets ignored within a week — which is how a conflict UI becomes worse
 * than no conflict UI.
 *
 * The base is the row as it stood when the local edit was made. Without it
 * there is no way to tell an edit from an unchanged field, and every sync
 * becomes a full-row collision.
 *
 * Kept in core rather than in the sync feature that first needed it, because
 * the workspace folder faces the same question about a note edited in two
 * places, and the answer must not be settled twice. `Row` is a plain map on
 * purpose: what a field means is the caller's business, and a merge that knew
 * about database columns could not also merge frontmatter.
 */

export type Row = Record<string, unknown>;

export interface FieldConflict {
  field: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

/** Named for the merge it belongs to; core already has a wiki-page merge. */
export interface FieldMergeResult {
  merged: Row;
  conflicts: FieldConflict[];
}

/**
 * Columns the merge has no business touching: they are the sync machinery's
 * own bookkeeping, and the server is the only author of them.
 */
const RESERVED = new Set(["id", "server_seq", "row_version", "created_at"]);

export function mergeRows(base: Row, local: Row, remote: Row): FieldMergeResult {
  const merged: Row = { ...remote };
  const conflicts: FieldConflict[] = [];

  for (const field of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (RESERVED.has(field)) continue;
    const b = base[field];
    const l = local[field];
    const r = remote[field];

    const localChanged = !same(b, l);
    const remoteChanged = !same(b, r);

    // Nobody touched it, or only one side did: there is nothing to decide.
    if (!localChanged) continue;
    if (!remoteChanged) {
      merged[field] = l;
      continue;
    }
    // Both moved it to the same place. Agreement is not a conflict.
    if (same(l, r)) {
      merged[field] = l;
      continue;
    }
    // Both moved it somewhere different. The remote value stands in the merged
    // row so the device stays consistent with the server until the reader
    // decides; the conflict carries all three sides so they can.
    conflicts.push({ field, base: b, local: l, remote: r });
  }

  return { merged, conflicts };
}

/**
 * Equality as the database means it.
 *
 * JSON round-tripping, because a jsonb column comes back as a structure and two
 * structurally identical values are the same value — comparing by reference
 * would report every untouched object as an edit.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" && typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
