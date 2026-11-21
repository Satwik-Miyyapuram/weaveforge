/**
 * Report sections as `<slug>--<id>.section.md` files (0.9.7 L3): same contract as the
 * `report_sections` repo (`wf_core::repos::report_sections`); laws in
 * test/file-report-section-repo.test.ts.
 */
import {
  NotFoundError,
  ReportSectionValidationError,
  type IReportSectionManager,
  type IReportSectionRepository,
  type IWorkspaceFs,
  type NewReportSectionInput,
  type ReportSection,
  type ReportSectionFilter,
  type ReportSectionTreeNode,
  type ReportStatus,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { FileEntityStore, type ProjectRoot } from "./file-entity-store";

/** Ascending, a missing value last (Postgres `order by … asc`). */
function compareOptional(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}

/**
 * A fresh `updatedAt`, always after `previous`: the AI report_edit check
 * compares it as the section's revision, so two saves in one millisecond
 * must still differ.
 */
function nextRevision(previous: string | undefined): string {
  const now = Date.now();
  const before = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isNaN(before) || now > before ? now : before + 1).toISOString();
}

function validation(error: unknown): never {
  throw new ReportSectionValidationError(error instanceof Error ? error.message : String(error));
}

export class FileReportSectionRepository implements IReportSectionRepository, IReportSectionManager {
  private readonly store: FileEntityStore<ReportSection>;

  constructor(fs: IWorkspaceFs, root: ProjectRoot) {
    this.store = new FileEntityStore<ReportSection>(fs, root, "report_section");
  }

  getById(id: string): Promise<ReportSection | null> {
    return this.store.get(id);
  }

  async list(filter: ReportSectionFilter = {}): Promise<ReportSection[]> {
    const needle = filter.titleContains?.toLowerCase();
    return (await this.store.all())
      .filter(
        (s) =>
          (!filter.status || s.status === filter.status) &&
          (filter.parentId === undefined || (s.parentId ?? null) === filter.parentId) &&
          (!needle || s.title.toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || compareOptional(a.sectionNo, b.sectionNo));
  }

  async getTree(): Promise<ReportSectionTreeNode[]> {
    return readyCore().buildSectionTree(await this.store.all()) as unknown as ReportSectionTreeNode[];
  }

  /** Stamps a new `updatedAt` past the stored one. */
  async save(section: ReportSection): Promise<void> {
    await this.stamped(section);
  }

  delete(id: string): Promise<void> {
    return this.store.delete(id);
  }

  remove(id: string): Promise<void> {
    return this.store.delete(id);
  }

  async add(input: NewReportSectionInput): Promise<ReportSection> {
    let made: ReportSection;
    try {
      made = readyCore().createReportSection(input, {
        clock: { nowIso: () => new Date().toISOString() },
        ids: { newId: () => crypto.randomUUID() },
      }) as unknown as ReportSection;
    } catch (error) {
      validation(error);
    }
    return this.stamped(made);
  }

  setTitle(id: string, title: string): Promise<ReportSection> {
    const trimmed = title.trim();
    if (!trimmed) return Promise.reject(new ReportSectionValidationError("Section title is required."));
    return this.update(id, (s) => ({ ...s, title: trimmed }));
  }

  async setParent(id: string, parentId: string | null): Promise<ReportSection> {
    if (parentId !== null) await this.assertNotUnder(id, parentId);
    return this.update(id, (s) => {
      const next = { ...s };
      if (parentId === null) delete next.parentId;
      else next.parentId = parentId;
      return next;
    });
  }

  setStatus(id: string, status: ReportStatus): Promise<ReportSection> {
    return this.update(id, (s) => ({ ...s, status }));
  }

  setProgress(id: string, wordCount: number): Promise<ReportSection> {
    if (wordCount < 0) return Promise.reject(new ReportSectionValidationError("Word count cannot be negative."));
    return this.update(id, (s) => ({ ...s, wordCount }));
  }

  setNotes(id: string, notes: string): Promise<ReportSection> {
    const text = notes.trim() ? notes : "";
    const wordCount = readyCore().countWords(text);
    return this.update(id, (s) => {
      const next = { ...s, wordCount };
      if (text) next.notes = text;
      else delete next.notes;
      return next;
    });
  }

  /** Climbs from `parentId`; reaching `id` is a loop. A loop already in the files ends quietly. */
  private async assertNotUnder(id: string, parentId: string): Promise<void> {
    const byId = new Map((await this.store.all()).map((s) => [s.id, s]));
    const seen = new Set<string>();
    for (let cursor: string | undefined = parentId; cursor; ) {
      if (cursor === id) throw new ReportSectionValidationError("A section cannot be moved inside itself.");
      if (seen.has(cursor)) return;
      seen.add(cursor);
      const node = byId.get(cursor);
      if (!node) throw new NotFoundError(`No report section with id "${parentId}".`);
      cursor = node.parentId;
    }
  }

  private async update(id: string, change: (s: ReportSection) => ReportSection): Promise<ReportSection> {
    const current = await this.store.get(id);
    if (!current) throw new NotFoundError(`No report section with id "${id}".`);
    return this.stamped(change(current));
  }

  private async stamped(section: ReportSection): Promise<ReportSection> {
    const stored = await this.store.get(section.id);
    const latest = [stored?.updatedAt, section.updatedAt].filter(Boolean).sort().at(-1);
    const next = { ...section, updatedAt: nextRevision(latest) };
    await this.store.save(next);
    return next;
  }
}
