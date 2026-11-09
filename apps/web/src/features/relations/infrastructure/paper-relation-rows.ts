import type { PaperRelation } from "@weaveforge/core";
import type { PaperRelationRow } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

/**
 * How paper relation rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 *
 * The mapping itself is Rust (`paper_relation_from_row` / `paper_relation_to_row`);
 * this file only names it for the repositories.
 */

export type { PaperRelationRow };

export function toDomain(row: PaperRelationRow): PaperRelation {
  return readyCore().paperRelationFromRow(row) as PaperRelation;
}

export function toRow(r: PaperRelation): PaperRelationRow {
  return readyCore().paperRelationToRow(r);
}
