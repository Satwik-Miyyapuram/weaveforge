import {
  createReportSection,
  ReportSectionValidationError,
  type NewReportSectionInput,
  type ReportSection,
  type ReportStatus,
} from "../domain/report-section.js";
import type { IReportSectionRepository } from "../domain/report-section-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

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
      throw new ReportSectionValidationError(`No report section with id "${id}".`);
    }
    const updated = change(existing);
    await this.deps.repository.save(updated);
    return updated;
  }
}
