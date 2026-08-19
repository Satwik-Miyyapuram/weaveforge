import type {
  LabSnapshot,
  LabSnapshotContent,
} from "@weaveforge/core";

/**
 * How lab snapshot rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers. They talk to the *same* table — one through
 * supabase-js, the other through `pg` — so the column shape and the mapping are
 * not per-provider facts, and holding two copies of them is how they drift.
 */

export interface LabSnapshotRow {
  id: string;
  project_id: string;
  title: string;
  note: string | null;
  content: LabSnapshotContent;
  published_at: string;
  created_at: string;
}

export function toDomain(row: LabSnapshotRow): LabSnapshot {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    note: row.note ?? undefined,
    content: row.content ?? { milestones: [], logs: [] },
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}
