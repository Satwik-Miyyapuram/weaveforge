import {
  createReportSection,
  ReportSectionValidationError,
  type NewReportSectionInput,
  type ReportSection,
  type ReportStatus,
} from "../domain/report-section.js";
import type { IReportSectionRepository } from "../domain/report-section-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";
import { NotFoundError } from "../../../shared/errors.js";

export interface ManageReportSectionDeps {
  repository: IReportSectionRepository;
  clock: Clock;
  ids: IdGenerator;
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export class ManageReportSectionUseCase {
  constructor(private readonly deps: ManageReportSectionDeps) {}

  async add(input: NewReportSectionInput): Promise<ReportSection> {
    const section = createReportSection(input, {
      clock: this.deps.clock,
      ids: this.deps.ids,
    });
    await this.deps.repository.save(section);
    return section;
  }

  /** Rename in place, from the explorer's inline editor. */
  async setTitle(id: string, title: string): Promise<ReportSection> {
    const trimmed = title.trim();
    if (!trimmed) throw new ReportSectionValidationError("Section title is required.");
    return this.mutate(id, (s) => ({ ...s, title: trimmed }));
  }

  /** Move under another section, or to the top with `null`. */
  async setParent(id: string, parentId: string | null): Promise<ReportSection> {
    if (parentId) {
      let cursor: string | undefined = parentId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) {
          throw new ReportSectionValidationError("A section cannot be moved inside itself.");
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const parent = await this.deps.repository.getById(cursor);
        if (!parent) throw new NotFoundError(`No report section with id "${parentId}".`);
        cursor = parent.parentId;
      }
    }
    return this.mutate(id, (s) => ({ ...s, parentId: parentId ?? undefined }));
  }

  async setStatus(id: string, status: ReportStatus): Promise<ReportSection> {
    return this.mutate(id, (s) => ({ ...s, status }));
  }

  async setProgress(id: string, wordCount: number): Promise<ReportSection> {
    if (wordCount < 0) {
      throw new ReportSectionValidationError("Word count cannot be negative.");
    }
    return this.mutate(id, (s) => ({ ...s, wordCount }));
  }

  /** Persist section body notes and keep wordCount in sync with the text. */
  async setNotes(id: string, notes: string): Promise<ReportSection> {
    const text = notes.trim() ? notes : "";
    return this.mutate(id, (s) => ({
      ...s,
      notes: text || undefined,
      wordCount: countWords(text),
    }));
  }

  async remove(id: string): Promise<void> {
    await this.deps.repository.delete(id);
  }

  private async mutate(
    id: string,
    change: (s: ReportSection) => ReportSection,
  ): Promise<ReportSection> {
    const existing = await this.deps.repository.getById(id);
    if (!existing) {
      // NotFound, not Validation: see the vault use case for the reasoning.
      throw new NotFoundError(`No report section with id "${id}".`);
    }
    const updated = change(existing);
    await this.deps.repository.save(updated);
    return updated;
  }
}
