import type { IReportSectionRepository, IShareRepository, ReportSection } from "@thesis/core";
import { buildSectionTree, mergePinnedScreenData } from "@thesis/core";
import type { ReportSectionTreeNode } from "@thesis/core";

export interface ReportScreenData {
  tree: ReportSectionTreeNode[];
  flat: ReportSection[];
  pinnedSharedBy: Map<string, string>;
  reportCanComment: Map<string, boolean>;
  reportCanEdit: Map<string, boolean>;
}

export class LoadReportScreenUseCase {
  constructor(
    private readonly deps: {
      sections: IReportSectionRepository;
      pins?: import("@thesis/core").ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<ReportScreenData> {
    const [owned, pins, shares] = await Promise.all([
      this.deps.sections.list(),
      this.deps.pins?.listForProject() ?? Promise.resolve([]),
      this.deps.shares?.listSharedWithMe("report_section") ?? Promise.resolve([]),
    ]);

    const merged = await mergePinnedScreenData({
      resourceType: "report_section",
      owned,
      pins,
      shares,
      loadById: (id) => this.deps.sections.getById(id),
    });

    return {
      tree: buildSectionTree(owned),
      flat: merged.items,
      pinnedSharedBy: merged.pinnedSharedBy,
      reportCanComment: merged.canComment,
      reportCanEdit: merged.canEdit,
    };
  }
}
