/**
 * Repository contract for report sections.
 *
 * Defined in the domain layer (Dependency Inversion). Adds `getTree()` for the
 * hierarchical outline on top of the generic read/write contract. Every
 * implementation must pass the shared contract test suite (Liskov).
 */

import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type {
  ReportSection,
  ReportSectionFilter,
  ReportSectionTreeNode,
} from "./report-section.js";

export interface IReportSectionRepository
  extends IReadableRepository<ReportSection, ReportSectionFilter>,
    IWritableRepository<ReportSection> {
  /** Return all sections assembled into the nested outline tree. */
  getTree(): Promise<ReportSectionTreeNode[]>;
}
