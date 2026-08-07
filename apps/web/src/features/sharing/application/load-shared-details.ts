import type {
  Experiment,
  IPaperRepository,
  IExperimentRepository,
  IVaultPageRepository,
  IReadingListRepository,
  Paper,
  VaultPage,
} from "@weaveforge/core";
import type { SharedItem } from "@/features/sharing/domain/shared-reader";

export type SharedItemDetail = SharedItem & {
  paper?: Paper;
  experiment?: Experiment;
  vaultPage?: VaultPage;
  canComment: boolean;
};

export async function loadSharedItemDetails(
  items: SharedItem[],
  deps: {
    papers: IPaperRepository;
    experiments: IExperimentRepository;
    vaultPages: IVaultPageRepository;
    readingLists?: IReadingListRepository;
  },
): Promise<SharedItemDetail[]> {
  const paperIds = [...new Set(items.filter((i) => i.kind === "paper").map((i) => i.id))];
  const experimentIds = [
    ...new Set(items.filter((i) => i.kind === "experiment").map((i) => i.id)),
  ];
  const vaultPageIds = [
    ...new Set(items.filter((i) => i.kind === "vault_page").map((i) => i.id)),
  ];
  const readingListIds = [
    ...new Set(items.filter((i) => i.kind === "reading_list").map((i) => i.id)),
  ];

  const [papers, experiments, vaultPages, readingLists] = await Promise.all([
    Promise.all(paperIds.map((id) => deps.papers.getById(id))),
    Promise.all(experimentIds.map((id) => deps.experiments.getById(id))),
    Promise.all(vaultPageIds.map((id) => deps.vaultPages.getById(id))),
    deps.readingLists
      ? Promise.all(readingListIds.map((id) => deps.readingLists!.getById(id)))
      : Promise.resolve([]),
  ]);

  const paperById = new Map(
    papers.filter((p): p is Paper => p != null).map((p) => [p.id, p]),
  );
  const experimentById = new Map(
    experiments.filter((e): e is Experiment => e != null).map((e) => [e.id, e]),
  );
  const vaultPageById = new Map(
    vaultPages.filter((v): v is VaultPage => v != null).map((v) => [v.id, v]),
  );
  const readingListById = new Map(
    readingLists.filter((l): l is NonNullable<(typeof readingLists)[number]> => l != null).map(
      (l) => [l.id, l],
    ),
  );

  return items.map((item) => ({
    ...item,
    title:
      item.kind === "reading_list"
        ? (readingListById.get(item.id)?.name ?? item.title)
        : item.title,
    paper: item.kind === "paper" ? paperById.get(item.id) : undefined,
    experiment: item.kind === "experiment" ? experimentById.get(item.id) : undefined,
    vaultPage: item.kind === "vault_page" ? vaultPageById.get(item.id) : undefined,
    canComment: false,
  }));
}
