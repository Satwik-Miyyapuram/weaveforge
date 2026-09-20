import type {
  ILibraryPinRepository,
  IReportSectionRepository,
  IShareRepository,
  ReportSection,
} from "@weaveforge/core";
import { buildSectionTree, loadPinnedScreenData } from "@weaveforge/core";
import type { ReportSectionTreeNode } from "@weaveforge/core";

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
      pins?: ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<ReportScreenData> {
    const owned = await this.deps.sections.list();

    const merged = await loadPinnedScreenData(this.deps, {
      resourceType: "report_section",
      owned,
      loadById: (id) => this.deps.sections.getById(id),
    });

    return {
      // From the merged set, not from `owned`. A shared section belongs in the
      // tree like any other: building the tree pre-merge put it in `flat` and
      // left it out of the only projection the screen paints, so the same data
      // had two different answers depending on which field you read.
      tree: buildSectionTree(merged.items),
      flat: merged.items,
      pinnedSharedBy: merged.pinnedSharedBy,
      reportCanComment: merged.canComment,
      reportCanEdit: merged.canEdit,
    };
  }
}
