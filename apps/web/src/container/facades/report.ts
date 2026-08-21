import type { ManageReportSectionUseCase, ReportSection } from "@weaveforge/core";
import type { LoadReportScreenUseCase, ReportScreenData } from "@/features/report/application/load-report-screen.use-case";
import { reportImagePathsInBody } from "@/features/report/lib/report-images-md";

export class ReportFacade {
  constructor(
    private readonly deps: {
      load: LoadReportScreenUseCase;
      sections: import("@weaveforge/core").IReportSectionRepository;
      manageReportSection: ManageReportSectionUseCase;
      images: import("@/features/report/infrastructure/report-image-store").ReportImageStore;
    },
  ) {}

  loadScreenData(): Promise<ReportScreenData> {
    return this.deps.load.execute();
  }

  getSection(id: string) {
    return this.deps.sections.getById(id);
  }

  get manageReportSection() {
    return this.deps.manageReportSection;
  }

  uploadImage(sectionId: string, blob: Blob, ext: string) {
    return this.deps.images.upload(sectionId, blob, ext);
  }

  fetchImageBlob(path: string) {
    return this.deps.images.fetchBlob(path);
  }

  fetchImageBlobs(paths: readonly string[]) {
    return this.deps.images.fetchBlobs(paths);
  }

  /**
   * Delete a section and best-effort remove `reportimg:` blobs referenced in its notes
   * (same pattern as paper delete + metadata.images).
   */
  async removeSection(section: ReportSection): Promise<void> {
    const paths = reportImagePathsInBody(section.notes ?? "");
    await Promise.all(
      paths.map(async (path) => {
        try {
          await this.deps.images.remove(path);
        } catch {
          /* best-effort — row delete still proceeds */
        }
      }),
    );
    await this.deps.manageReportSection.remove(section.id);
  }
}

export type { ReportScreenData };
