/**
 * Report (thesis) sections domain model — pure, no I/O, no SDK imports.
 *
 * A `ReportSection` is one node of the thesis outline. Sections form a
 * hierarchy (chapter > section) via `parentId`, mirroring `reading_lists`. One
 * reason to change: the rules of what a report section *is* (SRP).
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { buildTree } from "../../../shared/tree.js";

export type ReportStatus = "not_started" | "drafting" | "review" | "done";

export const REPORT_STATUSES: readonly ReportStatus[] = [
  "not_started",
  "drafting",
  "review",
  "done",
];

export interface ReportSection extends Identifiable {
  id: string;
  title: string;
  /** Outline number, e.g. "3.2". */
  sectionNo?: string;
  /** Parent section id for nesting (chapter > section); null/undefined = top. */
  parentId?: string;
  status: ReportStatus;
  wordCount: number;
  targetWords?: number;
  /** ISO date (yyyy-mm-dd). */
  deadline?: string;
  /** Overleaf / Google Doc / repo path. */
  draftUrl?: string;
  notes?: string;
  sortOrder: number;
  createdAt: string;
}

export interface NewReportSectionInput {
  title: string;
  sectionNo?: string;
  parentId?: string;
  status?: ReportStatus;
  wordCount?: number;
  targetWords?: number;
  deadline?: string;
  draftUrl?: string;
  notes?: string;
  sortOrder?: number;
}

export interface ReportSectionFilter {
  status?: ReportStatus;
  /** Use `null` to select only top-level sections. */
  parentId?: string | null;
  /** Case-insensitive substring match against title. */
  titleContains?: string;
}

/** A section with its descendants resolved (for rendering the outline tree). */
export interface ReportSectionTreeNode {
  section: ReportSection;
  children: ReportSectionTreeNode[];
}

export class ReportSectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportSectionValidationError";
  }
}

export function createReportSection(
  input: NewReportSectionInput,
  deps: { clock: Clock; ids: IdGenerator },
): ReportSection {
  const title = input.title?.trim();
  if (!title) {
    throw new ReportSectionValidationError("Section title is required.");
  }
  if (input.wordCount != null && input.wordCount < 0) {
    throw new ReportSectionValidationError("Word count cannot be negative.");
  }
  if (input.targetWords != null && input.targetWords < 0) {
    throw new ReportSectionValidationError("Target words cannot be negative.");
  }
  return {
    id: deps.ids.newId(),
    title,
    sectionNo: input.sectionNo?.trim() || undefined,
    parentId: input.parentId,
    status: input.status ?? "not_started",
    wordCount: input.wordCount ?? 0,
    targetWords: input.targetWords,
    deadline: input.deadline,
    draftUrl: input.draftUrl,
    notes: input.notes,
    sortOrder: input.sortOrder ?? 0,
    createdAt: deps.clock.nowIso(),
  };
}

/**
 * Build the outline tree from a flat list of sections (pure). Shared by every
 * repository implementation so `getTree()` behaves identically (Liskov).
 * Siblings are ordered by `sortOrder`, then `sectionNo`, then `title`.
 */
export function buildSectionTree(
  sections: readonly ReportSection[],
): ReportSectionTreeNode[] {
  return buildTree(sections, {
    id: (section) => section.id,
    parentId: (section) => section.parentId,
    node: (section) => ({ section, children: [] }),
    compare: (a, b) =>
      a.section.sortOrder - b.section.sortOrder ||
      (a.section.sectionNo ?? "").localeCompare(b.section.sectionNo ?? "") ||
      a.section.title.localeCompare(b.section.title),
  });
}
