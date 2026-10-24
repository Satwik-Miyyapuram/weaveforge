import type {
  IReportSectionRepository,
  ManageReportSectionUseCase,
  ReportSection,
  ReportSectionTreeNode,
} from "@weaveforge/core";
import type { LoadReportScreenUseCase, ReportScreenData } from "@/features/report/application/load-report-screen.use-case";
import { reportImagePathsInBody } from "@/features/report/lib/report-images-md";

export class ReportFacade {
  constructor(
    private readonly deps: {
      load: LoadReportScreenUseCase;
      sections: IReportSectionRepository;
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
   * Delete a section with its whole subtree, then best-effort remove the
   * `reportimg:` blobs referenced in any removed section's notes. The database
   * cascades the row delete to subsections, so the subtree goes in one step;
   * blobs go only after the rows are gone, so a failed delete loses no image.
   */
  async removeSection(section: ReportSection): Promise<void> {
    const tree = await this.deps.sections.getTree().catch(() => []);
    const node = findNode(tree, section.id);
    const removed = node ? flatten(node) : [section];
    const paths = [...new Set(removed.flatMap((s) => reportImagePathsInBody(s.notes ?? "")))];
    await this.deps.manageReportSection.remove(section.id);
    await Promise.all(
      paths.map(async (path) => {
        try {
          await this.deps.images.remove(path);
        } catch {
          /* best-effort — the rows are already gone */
        }
      }),
    );
  }
}

function findNode(nodes: readonly ReportSectionTreeNode[], id: string): ReportSectionTreeNode | undefined {
  for (const node of nodes) {
    if (node.section.id === id) return node;
    const hit = findNode(node.children, id);
    if (hit) return hit;
  }
  return undefined;
}

function flatten(node: ReportSectionTreeNode): ReportSection[] {
  return [node.section, ...node.children.flatMap(flatten)];
}

export type { ReportScreenData };
