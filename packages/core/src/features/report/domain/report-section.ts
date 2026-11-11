/** Types for report-section. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/parts.js";
import { ValidationError } from "../../../shared/errors.js";

/** A section's writing status, in workflow order. */
export const REPORT_STATUSES = ["not_started", "drafting", "review", "done"] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

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
  /** When the section last changed; set by the database, absent until first read back. */
  updatedAt?: string;
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

export class ReportSectionValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ReportSectionValidationError";
  }
}

