import { typedCore } from "@/lib/rust-core";
import {
  type ILibraryPinRepository,
  type IReportSectionRepository,
  type IShareRepository,
  loadPinnedScreenData,
  type ReportSection,
  type ReportSectionTreeNode,
} from "@weaveforge/core";

// --- link-overleaf-report ---
export type OverleafLink = { projectId: string; title: string; overleafProjectId: string; entryFile: string };

/**
 * Links an Overleaf project to a report. The link is checked before anything is
 * written: saving the connection first left a stored token behind whenever the
 * report row was then refused.
 */
export async function linkOverleafReport(
  link: OverleafLink,
  steps: {
    saveConnection: () => Promise<string>;
    createReport: (input: OverleafLink & { connectionId: string }) => Promise<unknown>;
    /** Undo `saveConnection` when the report is refused; omit when the connection was not new. */
    deleteConnection?: (id: string) => Promise<unknown>;
  },
): Promise<void> {
  const title = link.title.trim();
  const overleafProjectId = link.overleafProjectId.trim();
  const entryFile = link.entryFile.trim() || "main.tex";
  if (!title || !overleafProjectId) throw new Error("Title and Overleaf project id are required.");
  if (!typedCore().isOverleafProjectId(overleafProjectId)) throw new Error("Overleaf project id is invalid.");
  const entryFileInvalid = typedCore().entryFileError(entryFile);
  if (entryFileInvalid) throw new Error(entryFileInvalid);
  const connectionId = await steps.saveConnection();
  try {
    await steps.createReport({ ...link, title, overleafProjectId, entryFile, connectionId });
  } catch (err) {
    // A refused report must not leave the Git token it came with stored (P2-225).
    await steps.deleteConnection?.(connectionId).catch((cleanup: unknown) => {
      console.warn("Could not remove the unused Overleaf connection:", cleanup);
    });
    throw err;
  }
}

// --- load-report-screen.use-case ---
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
      tree: typedCore().buildSectionTree(merged.items),
      flat: merged.items,
      pinnedSharedBy: merged.pinnedSharedBy,
      reportCanComment: merged.canComment,
      reportCanEdit: merged.canEdit,
    };
  }
}
