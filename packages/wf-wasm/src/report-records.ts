/**
 * Report rules (Rust `report::prisma_figure`, `report::project_path`, `report::bibliography_report`,
 * `report::report_section`), re-exported from index.ts. Each function keeps the signature of the TS
 * file of the same name in packages/core/src/features/report/domain.
 */
import {
  buildSectionTree as rawBuildSectionTree,
  checkBibliography as rawCheckBibliography,
  createReportSectionWith as rawCreateReportSectionWith,
  normalizeProjectPath as rawNormalizeProjectPath,
  outlineProgress as rawOutlineProgress,
  prismaCaveat as rawPrismaCaveat,
  prismaFigureTex as rawPrismaFigureTex,
  reportSectionInputError as rawReportSectionInputError,
  sectionProgress as rawSectionProgress,
} from "../pkg/wf_wasm.js";
import type {
  BibEntry,
  BibliographyReport,
  BibWarning,
  ExclusionReasonCount,
  LatexSourceFile,
  NewReportSectionInput,
  PrismaCounts,
  PrismaFigureOptions,
  ReportSection,
  ReportSectionTreeNode,
  SectionProgress,
} from "./bindings.js";

/** The PRISMA flow diagram as a LaTeX figure. */
export function prismaFigureTex(
  counts: PrismaCounts,
  options: Omit<PrismaFigureOptions, "reasons"> & { reasons?: readonly ExclusionReasonCount[] | null } = {},
): string {
  return rawPrismaFigureTex(counts, options);
}

/** A warning when the counts do not add up, or null when they do. */
export function prismaCaveat(counts: PrismaCounts): string | null {
  return rawPrismaCaveat(counts) ?? null;
}

/** A project-relative path with `.` and `..` resolved, or null when it leaves the project. */
export function normalizeProjectPath(path: string): string | null {
  return rawNormalizeProjectPath(path) ?? null;
}

/** Every citation and bibliography finding in the project's sources. Entries carry their fields as a record, as in core. */
export function checkBibliography(input: {
  sources: readonly LatexSourceFile[];
  bibliography: {
    entries: readonly (Omit<BibEntry, "fields"> & { fields: Record<string, string> })[];
    warnings: readonly BibWarning[];
  };
}): BibliographyReport {
  return rawCheckBibliography({
    sources: input.sources,
    bibliography: {
      entries: input.bibliography.entries.map((entry) => ({
        ...entry,
        fields: Object.entries(entry.fields).map(([name, value]) => ({ name, value })),
      })),
      warnings: input.bibliography.warnings,
    },
  }) as BibliographyReport;
}

/** A new section from caller input. Throws `ReportSectionValidationError` before drawing an id. */
export function createReportSection(
  input: NewReportSectionInput,
  deps: { clock: { nowIso(): string }; ids: { newId(): string } },
): ReportSection {
  const message = rawReportSectionInputError(input);
  if (message != null) {
    const error = new Error(message);
    error.name = "ReportSectionValidationError";
    throw error;
  }
  const id = deps.ids.newId();
  const now = deps.clock.nowIso();
  return rawCreateReportSectionWith(input, id, now) as ReportSection;
}

/** Why `input` is not a valid new section, or null when it is. */
export function reportSectionInputError(input: NewReportSectionInput): string | null {
  return rawReportSectionInputError(input) ?? null;
}

/** A new section with the given id and timestamp; the caller has validated `input`. */
export function createReportSectionWith(input: NewReportSectionInput, id: string, now: string): ReportSection {
  return rawCreateReportSectionWith(input, id, now) as ReportSection;
}

/** The outline tree of a flat section list; siblings by sortOrder, sectionNo, then title. */
export function buildSectionTree(sections: readonly ReportSection[]): ReportSectionTreeNode[] {
  return rawBuildSectionTree(sections) as ReportSectionTreeNode[];
}

/** A section's words against its target, `null` where there is no target (`report::section_progress`). */
export type { SectionProgress };

/** Words written under a section, its own text and every subsection's, against its target. */
export function sectionProgress(node: ReportSectionTreeNode): SectionProgress {
  return normalizeProgress(rawSectionProgress(node));
}

/** The whole outline: its top-level sections added up. */
export function outlineProgress(roots: readonly ReportSectionTreeNode[]): SectionProgress {
  return normalizeProgress(rawOutlineProgress(roots));
}

/** Rust `None` crosses as `undefined`; the TS shape uses `null`. */
function normalizeProgress(raw: unknown): SectionProgress {
  const p = raw as { words: number; target?: number | null; pct?: number | null };
  return { words: p.words, target: p.target ?? null, pct: p.pct ?? null };
}
