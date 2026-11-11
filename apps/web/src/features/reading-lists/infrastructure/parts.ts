import { ProjectRepository } from "@/backend/providers/postgrest/project-scoped-repository";
import { inChunks, one, rows, run } from "@/backend/providers/postgrest/row-access";
import { readyCore, typedCore } from "@/lib/rust-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IReadingListItemRepository,
  IReadingListRepository,
  IScreeningRepository,
  ReadingList,
  ReadingListFilter,
  ReadingListItem,
  ReadingListTreeNode,
  ScreeningDecision,
} from "@weaveforge/core";
import type { ReadingListItemRow, ReadingListRow, ScreeningDecisionRow } from "@weaveforge/wasm";
import { itemFromWasm, listFromWasm, treeFromWasm } from "../application/parts";

// --- postgrest-reading-list-repository ---
// Row mapping runs in the Rust core (wf-core `reading_lists::list_row`).
const toListDomain = (row: ReadingListRow) => listFromWasm(typedCore().readingListToDomain(row));
const toListRow = (list: ReadingList) => typedCore().readingListToRow(list);
const toItemDomain = (row: ReadingListItemRow) => itemFromWasm(typedCore().readingListItemToDomain(row));
const toItemRow = (item: ReadingListItem) => typedCore().readingListItemToRow(item);

/**
 * PostgREST implementations of the reading-list repositories.
 *
 * Persistence only (snake_case <-> camelCase). The tree is assembled by the
 * shared pure helper so it matches the in-memory implementation. Both classes
 * must pass the same contract suites.
 */

/**
 * The columns a ReadingListRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
/**
 * The columns a ReadingListItemRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const READING_LIST_ITEM_COLUMNS = "id,list_id,paper_id,vault_page_id,sort_order,note,inherited_from_list_id,duplicate_of_item_id";

const READING_LIST_COLUMNS = "id,name,description,parent_id,sort_order,color,created_at";

const LISTS = "reading_lists";
const ITEMS = "reading_list_items";

export class PostgrestReadingListRepository extends ProjectRepository implements IReadingListRepository {

  async getById(id: string): Promise<ReadingList | null> {
    const row = await one<ReadingListRow>(this.db
      .from(LISTS)
      .select(READING_LIST_COLUMNS)
      .eq("id", id)
      .maybeSingle());
    return row ? toListDomain(row) : null;
  }

  /** Lists by id, filtered as `getById` is (not by project), in chunks. */
  async listByIds(ids: readonly string[]): Promise<ReadingList[]> {
    const found = await inChunks(ids, (chunk) =>
      rows<ReadingListRow>(
        this.db.from(LISTS).select(READING_LIST_COLUMNS).in("id", chunk).order("id", { ascending: true }),
      ),
    );
    return found.map(toListDomain);
  }

  async list(filter?: ReadingListFilter): Promise<ReadingList[]> {
    let query = this.db.from(LISTS).select(READING_LIST_COLUMNS);
    if (this.pid) query = query.eq("project_id", this.pid);
    if (filter?.parentId !== undefined) {
      query =
        filter.parentId === null
          ? query.is("parent_id", null)
          : query.eq("parent_id", filter.parentId);
    }
    query = query.order("sort_order", { ascending: true }).order("name");
    const all = (await rows<ReadingListRow>(query)).map(toListDomain);
    // Names are encrypted at rest, so the server cannot match them: filter here.
    // The per-name match runs in the Rust core (wf-core `reading_lists::name_filter`).
    const needle = filter?.nameContains;
    return needle ? all.filter((l) => typedCore().readingListNameMatches(l.name, needle)) : all;
  }

  async getTree(): Promise<ReadingListTreeNode[]> {
    return typedCore().buildListTree(await this.list()).map(treeFromWasm);
  }

  async save(entity: ReadingList): Promise<void> {
    const row = toListRow(entity);
    const payload: ReadingListRow & { project_id?: string } = this.pid ? { ...row, project_id: this.pid } : row;
    await run(this.db.from(LISTS).upsert(payload));
  }

  async delete(id: string): Promise<void> {
    await run(this.db.from(LISTS).delete().eq("id", id));
  }
}

export class PostgrestReadingListItemRepository
  implements IReadingListItemRepository
{
  constructor(private readonly db: SupabaseClient) {}

  async listItems(listId: string): Promise<ReadingListItem[]> {
    return (await rows<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select(READING_LIST_ITEM_COLUMNS)
      .eq("list_id", listId)
      .order("sort_order", { ascending: true }))).map(toItemDomain);
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    if (listIds.length === 0) return [];
    return (await rows<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select(READING_LIST_ITEM_COLUMNS)
      .in("list_id", listIds as string[])
      .order("sort_order", { ascending: true }))).map(toItemDomain);
  }

  async listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    return (await rows<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select(READING_LIST_ITEM_COLUMNS)
      .eq("paper_id", paperId))).map(toItemDomain);
  }

  async listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    return (await rows<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select(READING_LIST_ITEM_COLUMNS)
      .eq("vault_page_id", vaultPageId))).map(toItemDomain);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    const row = await one<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select(READING_LIST_ITEM_COLUMNS)
      .eq("list_id", listId)
      .eq("paper_id", paperId)
      .maybeSingle());
    return row ? toItemDomain(row) : null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    const row = await one<ReadingListItemRow>(this.db
      .from(ITEMS)
      .select(READING_LIST_ITEM_COLUMNS)
      .eq("list_id", listId)
      .eq("vault_page_id", vaultPageId)
      .maybeSingle());
    return row ? toItemDomain(row) : null;
  }

  async add(item: ReadingListItem): Promise<void> {
    await run(this.db.from(ITEMS).upsert(toItemRow(item)));
  }

  async remove(id: string): Promise<void> {
    await run(this.db.from(ITEMS).delete().eq("id", id));
  }
}

// --- postgrest-screening-repository ---
/**
 * Screening decisions, in the table both providers share.
 *
 * Persistence only. Note what is *not* here: no filtering by reviewer, and no
 * "my decision" convenience. Every reviewer's row comes back, because a screen
 * where you cannot see that somebody disagreed with you is not a screen -- and
 * the policies already decide which rows a caller may see.
 */

/**
 * The columns a ScreeningDecisionRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const SCREENING_DECISION_COLUMNS = "id,item_id,reviewer_id,stage,state,reason,decided_at";

const TABLE = "screening_decisions";

// Row mapping runs in the Rust core (wf-core `reading_lists::screening::decision_from_row`).
const toDomain = (row: ScreeningDecisionRow): ScreeningDecision =>
  readyCore().screeningDecisionFromRow(row) as ScreeningDecision;
const toRow = (decision: ScreeningDecision): ScreeningDecisionRow =>
  readyCore().screeningDecisionToRow(decision);

export class PostgrestScreeningRepository implements IScreeningRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listForItems(itemIds: readonly string[]): Promise<ScreeningDecision[]> {
    if (!itemIds.length) return [];
    const found = await rows<ScreeningDecisionRow>(
      this.db.from(TABLE).select(SCREENING_DECISION_COLUMNS).in("item_id", [...itemIds]).order("decided_at"),
    );
    return found.map(toDomain);
  }

  async record(decision: ScreeningDecision): Promise<void> {
    // Conflict on the natural key rather than the id: the same reviewer
    // answering the same item again is a change of mind, and the row it should
    // replace is the one they already wrote, whatever id the caller minted.
    await run(this.db.from(TABLE).upsert(toRow(decision), { onConflict: "item_id,reviewer_id,stage" }));
  }

  async remove(id: string): Promise<void> {
    await run(this.db.from(TABLE).delete().eq("id", id));
  }
}
