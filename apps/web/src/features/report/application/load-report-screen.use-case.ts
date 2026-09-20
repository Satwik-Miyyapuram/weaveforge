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
      tree: buildSectionTree(owned),
      flat: merged.items,
      pinnedSharedBy: merged.pinnedSharedBy,
      reportCanComment: merged.canComment,
      reportCanEdit: merged.canEdit,
    };
  }
}
