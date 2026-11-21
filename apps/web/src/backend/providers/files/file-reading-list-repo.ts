/**
 * Reading lists as `reading-lists/<slug>--<id>.list.md` files (0.9.7 L3). Same
 * contract as the `reading_lists` / `reading_list_items` repos; laws in
 * test/file-reading-list-repo.test.ts.
 *
 * Members live in the list file's `members` field, each naming its paper or note
 * by `[[link]]`, never by id:
 *
 * ```yaml
 * members:
 *   - "[[smith-2024.paper]]"                                   # written by hand
 *   - {"link":"[[My note--n1.note]]","id":"i2","order":1,"note":"key","from":"l0"}
 * ```
 *
 * A bare link is a member whose id is `<list id>:<paper or note id>` and whose order
 * is its place in the list. The app writes the object form, which keeps the item's
 * id, order, note, `from` (the list it is inherited from) and `duplicate-of`. A link
 * that resolves to nothing is not listed but stays in the file. Every other field
 * of the file (screening `items`, unknown keys) is kept as it is.
 */
import {
  NotFoundError,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type IWorkspaceFs,
  type ReadingList,
  type ReadingListFilter,
  type ReadingListItem,
  type ReadingListTreeNode,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { FileEntityStore, type ProjectRoot } from "./file-entity-store";
import { LinkIndex, type LinkTarget } from "./link-index";

/** The Postgres foreign-key code the service reads as "the `from` list is gone". */
const INHERITED_LINK_CODE = "23503";

interface MemberObject {
  link: string;
  id?: string;
  order?: number;
  note?: string;
  from?: string;
  "duplicate-of"?: string;
}

type Member = string | MemberObject;

type ListRow = ReadingList & { members?: Member[]; memberNotes?: unknown };

function linkOf(m: Member): string {
  return typeof m === "string" ? m : m.link;
}

function plainList({ members: _m, memberNotes: _n, ...list }: ListRow): ReadingList {
  return list;
}

function byOrderThenName(a: ReadingList, b: ReadingList): number {
  return a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function targetId(t: LinkTarget): string {
  return "paperId" in t ? t.paperId : t.vaultPageId;
}

function sameTarget(a: LinkTarget, b: LinkTarget): boolean {
  return ("paperId" in a) === ("paperId" in b) && targetId(a) === targetId(b);
}

export class FileReadingListRepository implements IReadingListRepository {
  private readonly store: FileEntityStore<ListRow>;

  constructor(fs: IWorkspaceFs, root: ProjectRoot) {
    this.store = new FileEntityStore<ListRow>(fs, root, "reading_list");
  }

  async getById(id: string): Promise<ReadingList | null> {
    const row = await this.store.get(id);
    return row ? plainList(row) : null;
  }

  async listByIds(ids: readonly string[]): Promise<ReadingList[]> {
    const wanted = new Set(ids);
    return (await this.store.all()).filter((l) => wanted.has(l.id)).map(plainList);
  }

  async list(filter: ReadingListFilter = {}): Promise<ReadingList[]> {
    const needle = filter.nameContains?.toLowerCase();
    return (await this.store.all())
      .map(plainList)
      .filter(
        (l) =>
          (filter.parentId === undefined || (l.parentId ?? null) === filter.parentId) &&
          (!needle || l.name.toLowerCase().includes(needle)),
      )
      .sort(byOrderThenName);
  }

  async getTree(): Promise<ReadingListTreeNode[]> {
    const lists = (await this.store.all()).map(plainList).sort(byOrderThenName);
    return readyCore().buildListTree(lists) as unknown as ReadingListTreeNode[];
  }

  /** Writes the list's own fields; its members are kept. */
  async save(list: ReadingList): Promise<void> {
    const current = await this.store.get(list.id);
    const next: ListRow = { ...plainList(list as ListRow) };
    if (current?.members !== undefined) next.members = current.members;
    if (current?.memberNotes !== undefined) next.memberNotes = current.memberNotes;
    await this.store.save(next);
  }

  delete(id: string): Promise<void> {
    return this.store.delete(id);
  }
}

export class FileReadingListItemRepository implements IReadingListItemRepository {
  private readonly store: FileEntityStore<ListRow>;
  private readonly links: LinkIndex;

  constructor(fs: IWorkspaceFs, root: ProjectRoot) {
    this.store = new FileEntityStore<ListRow>(fs, root, "reading_list");
    this.links = new LinkIndex(fs, root);
  }

  async listItems(listId: string): Promise<ReadingListItem[]> {
    const row = await this.store.get(listId);
    return row ? this.itemsOf(row) : [];
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    const wanted = new Set(listIds);
    const out: ReadingListItem[] = [];
    for (const row of await this.store.all()) if (wanted.has(row.id)) out.push(...(await this.itemsOf(row)));
    return out;
  }

  listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    return this.membershipsOf((i) => i.paperId === paperId);
  }

  listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    return this.membershipsOf((i) => i.vaultPageId === vaultPageId);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    return (await this.listItems(listId)).find((i) => i.paperId === paperId) ?? null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    return (await this.listItems(listId)).find((i) => i.vaultPageId === vaultPageId) ?? null;
  }

  /** Upsert by id, else by the paper or note: one membership per target in a list. */
  async add(item: ReadingListItem): Promise<void> {
    const target: LinkTarget | null = item.paperId
      ? { paperId: item.paperId }
      : item.vaultPageId
        ? { vaultPageId: item.vaultPageId }
        : null;
    if (!target) throw new NotFoundError("A reading-list item needs a paper or a note.");
    const found = await this.store.find(item.listId);
    if (!found) throw new NotFoundError(`No reading list with id "${item.listId}".`);
    if (item.inheritedFromListId && !(await this.store.get(item.inheritedFromListId))) {
      throw Object.assign(new Error(`No reading list with id "${item.inheritedFromListId}".`), {
        code: INHERITED_LINK_CODE,
      });
    }
    const link = await this.links.linkFor(target);
    if (!link) throw new NotFoundError(`No file for ${"paperId" in target ? "paper" : "note"} "${targetId(target)}".`);

    const entry: MemberObject = { link, id: item.id, order: item.sortOrder };
    if (item.note) entry.note = item.note;
    if (item.inheritedFromListId) entry.from = item.inheritedFromListId;
    if (item.duplicateOfItemId) entry["duplicate-of"] = item.duplicateOfItemId;

    const members = [...(found.row.members ?? [])];
    const resolved = await this.resolveAll(found.row.id, members);
    const at = resolved.findIndex((r) => r && (r.id === item.id || sameTarget(r.target, target)));
    if (at >= 0) members[at] = entry;
    else members.push(entry);
    await this.store.save({ ...found.row, members });
  }

  async remove(id: string): Promise<void> {
    for (const row of await this.store.all()) {
      const members = row.members ?? [];
      const resolved = await this.resolveAll(row.id, members);
      const at = resolved.findIndex((r) => r?.id === id);
      if (at < 0) continue;
      await this.store.save({ ...row, members: members.filter((_, i) => i !== at) });
      return;
    }
  }

  private async membershipsOf(match: (i: ReadingListItem) => boolean): Promise<ReadingListItem[]> {
    const out: ReadingListItem[] = [];
    for (const row of await this.store.all()) out.push(...(await this.itemsOf(row)).filter(match));
    return out;
  }

  /** The list's members that resolve, by order then place in the file. */
  private async itemsOf(row: ListRow): Promise<ReadingListItem[]> {
    const members = Array.isArray(row.members) ? row.members : [];
    const resolved = await this.resolveAll(row.id, members);
    const items: ReadingListItem[] = [];
    resolved.forEach((r, index) => {
      if (!r) return;
      const m = members[index]!;
      const item: ReadingListItem = { id: r.id, listId: row.id, ...r.target, sortOrder: index };
      if (typeof m !== "string") {
        if (typeof m.order === "number") item.sortOrder = m.order;
        if (m.note) item.note = m.note;
        if (m.from) item.inheritedFromListId = m.from;
        if (m["duplicate-of"]) item.duplicateOfItemId = m["duplicate-of"];
      }
      items.push(item);
    });
    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** Each member's target and item id, or null when its link resolves to nothing. */
  private async resolveAll(
    listId: string,
    members: readonly Member[],
  ): Promise<({ id: string; target: LinkTarget } | null)[]> {
    const out: ({ id: string; target: LinkTarget } | null)[] = [];
    const links = await this.links.snapshot();
    for (const m of members) {
      const link = typeof m === "string" || (m && typeof m === "object") ? linkOf(m) : undefined;
      const target = typeof link === "string" ? links.resolve(link) : null;
      if (!target) {
        out.push(null);
        continue;
      }
      const id = typeof m !== "string" && m.id ? m.id : `${listId}:${targetId(target)}`;
      out.push({ id, target });
    }
    return out;
  }
}
