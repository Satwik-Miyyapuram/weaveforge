import { readyCore, typedCore } from "@/lib/rust-core";
import {
  type AiWriteProposal,
  type ILibraryPinRepository,
  type IPaperRepository,
  type IReadingListRepository,
  type IShareRepository,
  type IVaultPageRepository,
  loadPinnedScreenData,
  type Paper,
  type PaperFieldDef,
  type PaperFieldValue,
  type PaperFieldValueData,
  type ReadingList,
  type ReadingListItem,
  type ReadingListTreeNode,
  type VaultPage,
} from "@weaveforge/core";

// --- extraction-rows ---
/** Table rules live in wf-core (`reading_lists::extraction_table`); this file adapts them. */

export type ExtractionColumnId = "title" | "year" | "status" | `field:${string}`;

export interface ExtractionRow {
  paper: Paper;
  values: Map<string, PaperFieldValueData>;
}

export interface PendingFieldFill {
  proposalId: string;
  paperId: string;
  fieldId: string;
  preview: string;
}

/** A relation or rollup cell's papers, by title (the id when the paper is gone; wf-core `extraction_keys`). */
export function relationTitles(ids: readonly unknown[], titleById: ReadonlyMap<string, string>): string {
  return readyCore().relationTitles(ids.map(String), titleById);
}

type CoreRows = Parameters<ReturnType<typeof readyCore>["extractionMarkdown"]>[0];

function toCoreRows(rows: readonly ExtractionRow[]): CoreRows {
  return rows.map((row) => ({
    paper: {
      id: row.paper.id,
      title: row.paper.title,
      year: row.paper.year ?? null,
      status: row.paper.status,
    },
    values: Object.fromEntries(row.values),
  })) as CoreRows;
}

type WasmFieldValues = ReturnType<ReturnType<typeof readyCore>["flattenPaperRows"]>[number]["values"];

/** Bindings type f64 as number | null (NaN/Infinity serialise as null); field values are always finite. */
function toDomainValues(values: WasmFieldValues): Map<string, PaperFieldValueData> {
  return new Map(Object.entries(values)) as Map<string, PaperFieldValueData>;
}

/**
 * Unique papers in list order; ignores vault notes. Wf-core decides which listed papers exist and
 * their order; this maps each returned index back to the paper object. Rollups: one wasm call.
 */
export function flattenPaperRows(
  papers: readonly Paper[],
  paperIds: readonly string[],
  allValues: readonly PaperFieldValue[],
  defs: readonly PaperFieldDef[] = [],
): ExtractionRow[] {
  const computed = readyCore().flattenPaperRows(
    papers.map((p) => p.id),
    paperIds,
    allValues,
    defs,
  );
  return computed.flatMap(({ paperIndex, values }) => {
    const paper = papers[paperIndex];
    return paper ? [{ paper, values: toDomainValues(values) }] : [];
  });
}

export function extractionMarkdown(
  rows: readonly ExtractionRow[],
  defs: readonly PaperFieldDef[],
  columns: readonly ExtractionColumnId[],
): string {
  return readyCore().extractionMarkdown(toCoreRows(rows), defs, columns);
}

export function extractionCsv(
  rows: readonly ExtractionRow[],
  defs: readonly PaperFieldDef[],
  columns: readonly ExtractionColumnId[],
): string {
  return readyCore().extractionCsv(toCoreRows(rows), defs, columns);
}

/** Papers whose cell for this field is empty and not already pending review. */
export function emptyCellPaperIds(
  rows: readonly ExtractionRow[],
  fieldId: string,
  pendingPaperIds: readonly string[],
): string[] {
  return readyCore().emptyCellPaperIds(toCoreRows(rows), fieldId, pendingPaperIds);
}

export function buildProposeFillPrompt(input: {
  listId: string;
  fieldId: string;
  fieldName: string;
  papers: readonly { id: string; title: string }[];
}): string {
  return readyCore().buildProposeFillPrompt({ ...input, papers: [...input.papers] });
}

// --- list-shapes ---
/** A grouped item as Rust returns it: generated shape, nullable where the domain type uses `?`. */
type WasmItem = ReturnType<ReturnType<typeof typedCore>["groupSubtreeItems"]>[number]["items"][number];

function itemFromWasm(item: WasmItem): ReadingListItem {
  return {
    id: item.id,
    listId: item.listId,
    paperId: item.paperId ?? undefined,
    vaultPageId: item.vaultPageId ?? undefined,
    sortOrder: item.sortOrder ?? 0,
    note: item.note ?? undefined,
    inheritedFromListId: item.inheritedFromListId ?? undefined,
    duplicateOfItemId: item.duplicateOfItemId ?? undefined,
  };
}

// --- load-reading-lists-screen.use-case ---
export interface ReadingListsScreenData {
  tree: ReadingListTreeNode[];
  lists: ReadingList[];
  papers: Paper[];
  notes: VaultPage[];
  pinnedSharedBy: Map<string, string>;
  listCanComment: Map<string, boolean>;
}

export class LoadReadingListsScreenUseCase {
  constructor(
    private readonly deps: {
      lists: IReadingListRepository;
      papers: IPaperRepository;
      notes: IVaultPageRepository;
      pins?: ILibraryPinRepository;
      shares?: IShareRepository;
    },
  ) {}

  async execute(): Promise<ReadingListsScreenData> {
    const [owned, papers, notes] = await Promise.all([
      this.deps.lists.list(),
      this.deps.papers.list(),
      this.deps.notes.list(),
    ]);

    const merged = await loadPinnedScreenData(this.deps, {
      resourceType: "reading_list",
      owned,
      loadById: (id) => this.deps.lists.getById(id),
    });

    return {
      // From the merged set: a list shared with this project belongs in the tree
      // a reader navigates, not only in the flat list beside it. Building the
      // tree pre-merge is what hid every shared list from the tree view.
      tree: typedCore().buildListTree(merged.items),
      lists: merged.items,
      papers,
      notes,
      pinnedSharedBy: merged.pinnedSharedBy,
      listCanComment: merged.canComment,
    };
  }
}

// --- subtree-items ---
/**
 * Items for every list in a subtree, from one fetch, grouped by list (36-08).
 * Every list in the subtree gets an entry, empty when it holds nothing; the
 * fetch order is kept within each list.
 */
export async function loadSubtreeItems(
  node: ReadingListTreeNode,
  fetchItems: (listIds: readonly string[]) => Promise<ReadingListItem[]>,
): Promise<Map<string, ReadingListItem[]>> {
  const core = readyCore();
  const items = await fetchItems(core.subtreeIds(node));
  return new Map(core.groupSubtreeItems(node, items).map((group): [string, ReadingListItem[]] => [group.listId, group.items.map(itemFromWasm)]));
}
