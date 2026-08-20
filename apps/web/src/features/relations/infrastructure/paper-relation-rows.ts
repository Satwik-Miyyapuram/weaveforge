import type {
  PaperRelation,
  RelationType,
} from "@weaveforge/core";

/**
 * How paper relation rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface PaperRelationRow {
  id: string;
  from_paper: string;
  to_paper: string;
  relation: RelationType;
  note: string | null;
  source: "manual" | "auto";
  created_at: string;
}

export function toDomain(row: PaperRelationRow): PaperRelation {
  return {
    id: row.id,
    fromPaper: row.from_paper,
    toPaper: row.to_paper,
    relation: row.relation,
    note: row.note ?? undefined,
    source: row.source,
    createdAt: row.created_at,
  };
}

export function toRow(r: PaperRelation): Record<string, unknown> {
  return {
    id: r.id,
    from_paper: r.fromPaper,
    to_paper: r.toPaper,
    relation: r.relation,
    note: r.note ?? null,
    source: r.source,
    created_at: r.createdAt,
  };
}
