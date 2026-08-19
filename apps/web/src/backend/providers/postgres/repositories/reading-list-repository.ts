import {
  buildListTree,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type ReadingList,
  type ReadingListFilter,
  type ReadingListItem,
  type ReadingListTreeNode,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";
import {
  type ReadingListRow,
  type ReadingListItemRow,
  toListDomain,
  toListRow,
  toItemDomain,
  toItemRow,
} from "@/features/reading-lists/infrastructure/reading-list-rows";

export class PostgresReadingListRepository implements IReadingListRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<ReadingList | null> {
    const row = await this.pg.queryOne<ReadingListRow>(
      "select * from reading_lists where id = $1",
      [id],
    );
    return row ? toListDomain(row) : null;
  }

  async list(filter?: ReadingListFilter): Promise<ReadingList[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    if (filter?.parentId !== undefined) {
      if (filter.parentId === null) {
        clauses.push("parent_id is null");
      } else {
        params.push(filter.parentId);
        clauses.push(`parent_id = $${params.length}`);
      }
    }
    if (filter?.nameContains) {
      // Server ilike removed under E2EE — encryptRepo filters client-side post-decrypt.
    }
    const rows = await this.pg.query<ReadingListRow>(
      `select * from reading_lists where ${clauses.join(" and ")}
       order by sort_order asc, name asc`,
      params,
    );
    return rows.map(toListDomain);
  }

  async getTree(): Promise<ReadingListTreeNode[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const rows = await this.pg.query<ReadingListRow>(
      `select * from reading_lists where ${clauses.join(" and ")}`,
      params,
    );
    return buildListTree(rows.map(toListDomain));
  }

  async save(entity: ReadingList): Promise<void> {
    const row = toListRow(entity);
    if (this.pid) row.project_id = this.pid;
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into reading_lists (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from reading_lists where id = $1", [id]);
  }
}

export class PostgresReadingListItemRepository implements IReadingListItemRepository {
  constructor(private readonly pg: PgRunner) {}

  async listItems(listId: string): Promise<ReadingListItem[]> {
    const rows = await this.pg.query<ReadingListItemRow>(
      "select * from reading_list_items where list_id = $1 order by sort_order asc",
      [listId],
    );
    return rows.map(toItemDomain);
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    if (listIds.length === 0) return [];
    const rows = await this.pg.query<ReadingListItemRow>(
      "select * from reading_list_items where list_id = any($1::uuid[]) order by sort_order asc",
      [listIds],
    );
    return rows.map(toItemDomain);
  }

  async listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    const rows = await this.pg.query<ReadingListItemRow>(
      "select * from reading_list_items where paper_id = $1",
      [paperId],
    );
    return rows.map(toItemDomain);
  }

  async listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    const rows = await this.pg.query<ReadingListItemRow>(
      "select * from reading_list_items where vault_page_id = $1",
      [vaultPageId],
    );
    return rows.map(toItemDomain);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    const row = await this.pg.queryOne<ReadingListItemRow>(
      "select * from reading_list_items where list_id = $1 and paper_id = $2",
      [listId, paperId],
    );
    return row ? toItemDomain(row) : null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    const row = await this.pg.queryOne<ReadingListItemRow>(
      "select * from reading_list_items where list_id = $1 and vault_page_id = $2",
      [listId, vaultPageId],
    );
    return row ? toItemDomain(row) : null;
  }

  async add(item: ReadingListItem): Promise<void> {
    const row = toItemRow(item);
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into reading_list_items (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async remove(id: string): Promise<void> {
    await this.pg.exec("delete from reading_list_items where id = $1", [id]);
  }
}

