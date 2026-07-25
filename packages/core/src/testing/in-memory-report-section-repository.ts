/**
 * In-memory implementation of IReportSectionRepository.
 *
 * Reference implementation for tests and the Liskov substitutability contract.
 */

import {
  buildSectionTree,
  type ReportSection,
  type ReportSectionFilter,
  type ReportSectionTreeNode,
} from "../features/report/domain/report-section.js";
import type { IReportSectionRepository } from "../features/report/domain/report-section-repository.js";

export class InMemoryReportSectionRepository
  implements IReportSectionRepository
{
  private readonly store = new Map<string, ReportSection>();

  async getById(id: string): Promise<ReportSection | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: ReportSectionFilter): Promise<ReportSection[]> {
    let items = [...this.store.values()];
    if (filter?.status) {
      items = items.filter((s) => s.status === filter.status);
    }
    if (filter?.parentId !== undefined) {
      const target = filter.parentId ?? undefined;
      items = items.filter((s) => (s.parentId ?? undefined) === target);
    }
    if (filter?.titleContains) {
      const needle = filter.titleContains.toLowerCase();
      items = items.filter((s) => s.title.toLowerCase().includes(needle));
    }
    return items.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        (a.sectionNo ?? "").localeCompare(b.sectionNo ?? "") ||
        a.title.localeCompare(b.title),
    );
  }

  async getTree(): Promise<ReportSectionTreeNode[]> {
    return buildSectionTree([...this.store.values()]);
  }

  async save(entity: ReportSection): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
