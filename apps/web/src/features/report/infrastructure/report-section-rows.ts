import { type ReportSection, type ReportStatus } from "@weaveforge/core";
/**
 * How report section rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers, which talk to the same table through
 * different clients. The Supabase repository layers the encrypted-row columns
 * on top of this; Postgres does not have them.
 */

export interface ReportSectionRow {
  id: string;
  title: string;
  section_no: string | null;
  parent_id: string | null;
  status: ReportStatus;
  word_count: number;
  target_words: number | null;
  deadline: string | null;
  draft_url: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

export function reportSectionToDomain(row: ReportSectionRow): ReportSection {
  return {
    id: row.id,
    title: row.title,
    sectionNo: row.section_no ?? undefined,
    parentId: row.parent_id ?? undefined,
    status: row.status,
    wordCount: row.word_count,
    targetWords: row.target_words ?? undefined,
    deadline: row.deadline ?? undefined,
    draftUrl: row.draft_url ?? undefined,
    notes: row.notes ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function reportSectionToRow(s: ReportSection): Record<string, unknown> {
  return {
    id: s.id,
    title: s.title,
    section_no: s.sectionNo ?? null,
    parent_id: s.parentId ?? null,
    status: s.status,
    word_count: s.wordCount,
    target_words: s.targetWords ?? null,
    deadline: s.deadline ?? null,
    draft_url: s.draftUrl ?? null,
    notes: s.notes ?? null,
    sort_order: s.sortOrder,
    created_at: s.createdAt,
  };
}
