import { getContainer } from "@/bootstrap";
import type { ISharedReader, SharedItem } from "@/features/sharing/domain/shared-reader";
import { readyCore } from "@/lib/rust-core";
import type {
  Experiment,
  IExperimentRepository,
  IMemberRepository,
  IPaperRepository,
  IReadingListRepository,
  IVaultPageRepository,
  ManageSharingUseCase,
  Member,
  Paper,
  VaultPage,
} from "@weaveforge/core";

// --- load-pinned-owner-names ---
/** Resolve display names for pinned/shared resource owners (DRY across screens). */
export async function loadPinnedOwnerNames(
  pinnedSharedBy: Map<string, string>,
): Promise<Map<string, string>> {
  if (pinnedSharedBy.size === 0) return new Map();
  const dir = await getContainer().sharing.listDirectory();
  const names = readyCore().memberNameMap(dir);
  for (const ownerId of new Set(pinnedSharedBy.values())) {
    if (!names.has(ownerId)) names.set(ownerId, "Member");
  }
  return names;
}

// --- load-shared-details ---
export type SharedItemDetail = SharedItem & {
  paper?: Paper;
  experiment?: Experiment;
  vaultPage?: VaultPage;
  canComment: boolean;
};

/**
 * Rows by id through the repository's own batch read when it has one, so the
 * repository's filtering is the same as its single read; otherwise one read
 * per id. Unknown ids are left out either way. No ids, no request.
 */
async function readByIds<T>(
  repo: {
    getById(id: string): Promise<T | null>;
    listByIds?(ids: readonly string[]): Promise<T[]>;
  },
  ids: string[],
): Promise<(T | null)[]> {
  if (ids.length === 0) return [];
  if (repo.listByIds) return repo.listByIds(ids);
  return Promise.all(ids.map((id) => repo.getById(id)));
}

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
    readByIds(deps.papers, paperIds),
    readByIds(deps.experiments, experimentIds),
    readByIds(deps.vaultPages, vaultPageIds),
    deps.readingLists ? readByIds(deps.readingLists, readingListIds) : Promise.resolve([]),
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

// --- load-shared-with-me-screen.use-case ---
export interface LoadSharedWithMeScreenData {
  items: SharedItemDetail[];
  members: Member[];
}

export class LoadSharedWithMeScreenUseCase {
  constructor(
    private readonly deps: {
      sharing: ManageSharingUseCase;
      sharedReader: ISharedReader;
      members: IMemberRepository;
      papers: IPaperRepository;
      experiments: IExperimentRepository;
      vaultPages: IVaultPageRepository;
      readingLists: IReadingListRepository;
    },
  ) {}

  async execute(): Promise<LoadSharedWithMeScreenData> {
    const [shares, members] = await Promise.all([
      this.deps.sharing.listSharedWithMe(),
      this.deps.members.listDirectory(),
    ]);

    const groups = await Promise.all(
      readyCore().shareableTypes().map((type) => {
        const { ids, owners } = readyCore().shareTargets(shares, type);
        return this.deps.sharedReader.read(type, ids, owners);
      }),
    );
    const enriched = await loadSharedItemDetails(groups.flat(), {
      papers: this.deps.papers,
      experiments: this.deps.experiments,
      vaultPages: this.deps.vaultPages,
      readingLists: this.deps.readingLists,
    });
    const items = enriched.map((item) => ({
      ...item,
      canComment: shares.some((s) =>
        readyCore().shareAllowsComment(s, item.kind, item.id, item.ownerId),
      ),
    }));

    return { items, members };
  }
}
