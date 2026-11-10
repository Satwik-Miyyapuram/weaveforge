import type { LabSnapshotContent } from "@weaveforge/core";

/**
 * How lab snapshot rows are stored. The mapping to the domain type is in Rust (wf-core).
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

