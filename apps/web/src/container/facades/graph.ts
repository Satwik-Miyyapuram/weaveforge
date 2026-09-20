import type {
  AddRelationUseCase,
  IPaperRelationRepository,
  IPaperRepository,
  IReadingListItemRepository,
  IReadingListRepository,
  IReportSectionRepository,
  ITagRepository,
  IVaultPageRepository,
  LinkCitationsUseCase,
  ManageTagsUseCase,
  Paper,
  PaperRelation,
  ReadingList,
  ReportSection,
  VaultPage,
} from "@weaveforge/core";
import type { IGraphSettingsRepository, GraphPersistedState } from "@weaveforge/core";
import type { RemoveRelationUseCase } from "@weaveforge/core";

export interface GraphScreenData {
  papers: Paper[];
  notes: VaultPage[];
  sections: ReportSection[];
  relations: PaperRelation[];
  lists: ReadingList[];
  membership: Map<string, Set<string>>;
}

export class GraphFacade {
  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      notes: IVaultPageRepository;
      sections: IReportSectionRepository;
      relations: IPaperRelationRepository;
      lists: IReadingListRepository;
      listItems: IReadingListItemRepository;
      addRelation: AddRelationUseCase;
      linkCitations: LinkCitationsUseCase;
      removeRelation: RemoveRelationUseCase;
      manageTags: ManageTagsUseCase;
      tags: ITagRepository;
      settings: IGraphSettingsRepository;
    },
  ) {}

  async loadScreenData(): Promise<GraphScreenData> {
    const [papers, notes, sections, relations, lists] = await Promise.all([
      this.deps.papers.list(),
      this.deps.notes.list(),
      this.deps.sections.list(),
      this.deps.relations.getGraph(),
      this.deps.lists.list(),
    ]);
    const items = await this.deps.listItems.listItemsForLists(lists.map((l) => l.id));
    const membership = new Map<string, Set<string>>(lists.map((l) => [l.id, new Set<string>()]));
    for (const it of items) {
      if (it.paperId) membership.get(it.listId)?.add(it.paperId);
    }
    return { papers, notes, sections, relations, lists, membership };
  }

  removeRelation(id: string) {
    return this.deps.removeRelation.execute(id);
  }

  get addRelation() {
    return this.deps.addRelation;
  }
  get linkCitations() {
    return this.deps.linkCitations;
  }
  get manageTags() {
    return this.deps.manageTags;
  }
  get tags() {
    return this.deps.tags;
  }

  getSettings(projectId: string) {
    return this.deps.settings.get(projectId);
  }

  saveSettings(projectId: string, state: GraphPersistedState) {
    return this.deps.settings.save(projectId, state);
  }
}
