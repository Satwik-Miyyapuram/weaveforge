import { getContainer } from "@/bootstrap";
import type { ISharedReader, SharedItem } from "@/features/sharing/domain/shared-reader";
import { readyCore } from "@/lib/rust-core";
import { logToApp } from "@/lib/error-report/app-log";
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
  ShareableType,
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
  /** Types whose shared items could not be read this time; the rest are still in `items`. */
  unavailable: ShareableType[];
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

    // One read per type, settled apart, so one failing type does not hide the others.
    const types = readyCore().shareableTypes();
    const settled = await Promise.allSettled(
      types.map((type) => {
        const { ids, owners } = readyCore().shareTargets(shares, type);
        return this.deps.sharedReader.read(type, ids, owners);
      }),
    );
    const groups: SharedItem[][] = [];
    const unavailable: ShareableType[] = [];
    types.forEach((type, i) => {
      const result = settled[i];
      if (result?.status === "fulfilled") groups.push(result.value);
      // A retired table (1.0.0 drops the personal tables) holds nothing to show.
      // The tables are only held in 0.9.8, so the log still notes a stale schema cache.
      else if (result && HELD_DROP_TYPES.has(type) && isMissingTable(result.reason)) {
        logToApp({
          level: "warn",
          source: "shared-with-me",
          message: `missing table for shared ${type} (${errorCode(result.reason)}), read as empty`,
        });
      } else if (result) {
        unavailable.push(type);
        if (isMissingTable(result.reason)) {
          logToApp({
            level: "warn",
            source: "shared-with-me",
            message: `missing table for shared ${type} (stale schema cache?)`,
          });
        }
      }
    });
    if (unavailable.length === types.length) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
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

    return { items, members, unavailable };
  }
}

/**
 * Types whose table 1.0.0 drops (0165/0167). Only for these is a missing table
 * expected; elsewhere PGRST205 more likely means a stale schema cache.
 */
const HELD_DROP_TYPES: ReadonlySet<ShareableType> = new Set([
  "paper",
  "vault_page",
  "report_section",
  "reading_list",
  "milestone",
]);

/** PostgREST's "table not in the schema cache" (404) or Postgres's undefined_table. */
function isMissingTable(error: unknown): boolean {
  const code = errorCode(error);
  return code === "PGRST205" || code === "42P01";
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}
