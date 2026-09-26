import type {
  AddRelationUseCase,
  Experiment,
  GraphExperimentEntry,
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
import { buildListMembership, paperIdOfItem } from "@weaveforge/core";
/**
 * The shape the graph builder takes, imported rather than restated.
 *
 * `build-graph-data` is the module that decides what a run contributes to the
 * canvas, so it owns the type too — a second declaration here would be a second
 * answer to what a run on the graph is, and the one that drifted would be the
 * one nobody noticed until a field stopped arriving.
 */


export interface GraphScreenData {
  papers: Paper[];
  notes: VaultPage[];
  sections: ReportSection[];
  relations: PaperRelation[];
  lists: ReadingList[];
  membership: Map<string, Set<string>>;
  /**
   * The project's runs, as the graph draws them.
   *
   * A few fields rather than the entities, matching `ExperimentEntry`: the graph
   * needs a run's name, its status and the paper it tests, and giving it whole
   * `Experiment` rows would put metric payloads and config blobs into a node
   * array that react-force-graph clones on every layout pass.
   */
  experiments: GraphExperimentEntry[];
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
      experiments: { list(): Promise<Experiment[]> };
      addRelation: AddRelationUseCase;
      linkCitations: LinkCitationsUseCase;
      removeRelation: RemoveRelationUseCase;
      manageTags: ManageTagsUseCase;
      tags: ITagRepository;
      settings: IGraphSettingsRepository;
    },
  ) {}

  async loadScreenData(): Promise<GraphScreenData> {
    const [papers, notes, sections, relations, lists, runs] = await Promise.all([
      this.deps.papers.list(),
      this.deps.notes.list(),
      this.deps.sections.list(),
      this.deps.relations.getGraph(),
      this.deps.lists.list(),
      // One extra read on a screen that already does six. A run with no
      // `relatedPaper` is filtered out by the builder rather than here, so the
      // rule about what reaches the canvas lives in one place.
      this.deps.experiments.list(),
    ]);
    const items = await this.deps.listItems.listItemsForLists(lists.map((l) => l.id));
    const membership = buildListMembership(lists, items, paperIdOfItem);
    return {
      papers,
      notes,
      sections,
      relations,
      lists,
      membership,
      experiments: runs.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        relatedPaper: e.relatedPaper,
        note: [e.hypothesis, e.resultNote].filter(Boolean).join("\n") || undefined,
      })),
    };
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
