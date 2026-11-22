/**
 * Reading lists as `reading-lists/<slug>--<id>.list.md` files (0.9.7 L3). Same
 * contract as the `reading_lists` / `reading_list_items` repos; laws in
 * test/file-reading-list-repo.test.ts.
 *
 * Members live in the list file's `members` field as plain `[[links]]`, never ids, so
 * a tool that renames a file and rewrites its links (Obsidian) keeps the list whole.
 * What the app knows about each item sits apart in `member-notes`, keyed by the
 * paper or note the link resolves to, so a rename never orphans it:
 *
 * ```yaml
 * members: ["[[smith-2024.paper]]", "[[My note.note]]"]
 * member-notes: {"note:n1": {"id":"i2","order":1,"note":"key","from":"l0"}}
 * ```
 *
 * A member with no entry has the id `<list id>:<paper or note id>` and its place in
 * the list as its order. An entry keeps the item's id, order, note, `from` (the list
 * it is inherited from) and `duplicate-of`. A link that resolves to nothing is not
 * listed but stays in the file. The older object form
 * (`{"link":"[[x]]","id":…}`) still reads, and becomes a plain link on the next
 * write. Every other field of the file (screening `items`, unknown keys) is kept.
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

/** What the app keeps about one member, beside its link. */
interface MemberInfo {
  id?: string;
  order?: number;
  note?: string;
  from?: string;
  "duplicate-of"?: string;
}

/** A plain link, or the older object form that carried its info inline. */
type Member = string | (MemberInfo & { link: string });

type MemberNotes = Record<string, MemberInfo>;

type ListRow = ReadingList & { members?: Member[]; memberNotes?: unknown };

interface Resolved {
  id: string;
  target: LinkTarget;
  link: string;
  info: MemberInfo;
}

/** The `member-notes` key for a paper or note. */
function infoKey(t: LinkTarget): string {
  return "paperId" in t ? `paper:${t.paperId}` : `note:${t.vaultPageId}`;
}

function notesOf(row: ListRow): MemberNotes {
  const n = row.memberNotes;
  return n && typeof n === "object" && !Array.isArray(n) ? (n as MemberNotes) : {};
}

/**
 * The row with `members` as plain links and each resolved one's info in `member-notes`.
 * An unresolved member, and any entry it may own, is kept as it is.
 */
function written(row: ListRow, members: readonly Member[], resolved: readonly (Resolved | null)[]): ListRow {
  const memberNotes: MemberNotes = { ...notesOf(row) };
  const plain = members.map((m, i) => {
    const r = resolved[i];
    if (!r) return m;
    const info: MemberInfo = { ...r.info };
    if (info.id === `${row.id}:${targetId(r.target)}`) delete info.id;
    if (Object.keys(info).length) memberNotes[infoKey(r.target)] = info;
    else delete memberNotes[infoKey(r.target)];
    return r.link;
  });
  return { ...row, members: plain, memberNotes };
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
    return this.listItemsForLists([listId]);
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    const wanted = new Set(listIds);
    const rows = await this.store.all();
    const live = new Set(rows.map((r) => r.id));
    const out: ReadingListItem[] = [];
    for (const row of rows) if (wanted.has(row.id)) out.push(...(await this.itemsOf(row, live)));
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

    const info: MemberInfo = { id: item.id, order: item.sortOrder };
    if (item.note) info.note = item.note;
    if (item.inheritedFromListId) info.from = item.inheritedFromListId;
    if (item.duplicateOfItemId) info["duplicate-of"] = item.duplicateOfItemId;
    const entry: Resolved = { id: item.id, target, link, info };

    const members = this.membersOf(found.row);
    const resolved = await this.resolveAll(found.row, members);
    const at = resolved.findIndex((r) => r && (r.id === item.id || sameTarget(r.target, target)));
    if (at >= 0) {
      members[at] = link;
      resolved[at] = entry;
    } else {
      members.push(link);
      resolved.push(entry);
    }
    await this.store.save(written(found.row, members, resolved));
  }

  async remove(id: string): Promise<void> {
    for (const row of await this.store.all()) {
      const members = this.membersOf(row);
      const resolved = await this.resolveAll(row, members);
      const at = resolved.findIndex((r) => r?.id === id);
      if (at < 0) continue;
      const next = written(row, members, resolved);
      delete (next.memberNotes as MemberNotes)[infoKey(resolved[at]!.target)];
      await this.store.save({ ...next, members: next.members!.filter((_, i) => i !== at) });
      return;
    }
  }

  private membersOf(row: ListRow): Member[] {
    return Array.isArray(row.members) ? [...row.members] : [];
  }

  private async membershipsOf(match: (i: ReadingListItem) => boolean): Promise<ReadingListItem[]> {
    const rows = await this.store.all();
    const live = new Set(rows.map((r) => r.id));
    const out: ReadingListItem[] = [];
    for (const row of rows) out.push(...(await this.itemsOf(row, live)).filter(match));
    return out;
  }

  /**
   * The list's members that resolve, by order then place in the file. A `from` naming
   * a list not in `live` is dropped, as Postgres's `on delete set null` did.
   */
  private async itemsOf(row: ListRow, live: ReadonlySet<string>): Promise<ReadingListItem[]> {
    const resolved = await this.resolveAll(row, this.membersOf(row));
    const items: ReadingListItem[] = [];
    resolved.forEach((r, index) => {
      if (!r) return;
      const { info } = r;
      const item: ReadingListItem = { id: r.id, listId: row.id, ...r.target, sortOrder: index };
      if (typeof info.order === "number") item.sortOrder = info.order;
      if (info.note) item.note = info.note;
      if (info.from && live.has(info.from)) item.inheritedFromListId = info.from;
      if (info["duplicate-of"]) item.duplicateOfItemId = info["duplicate-of"];
      items.push(item);
    });
    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Each member's target, link, info and item id, or null when its link resolves to
   * nothing. Info inline in an older object-form member wins over `member-notes`.
   */
  private async resolveAll(row: ListRow, members: readonly Member[]): Promise<(Resolved | null)[]> {
    const notes = notesOf(row);
    const links = await this.links.snapshot();
    return members.map((m) => {
      const link = typeof m === "string" ? m : m && typeof m === "object" ? m.link : undefined;
      const target = typeof link === "string" ? links.resolve(link) : null;
      if (!target) return null;
      const { link: _l, ...inline } = typeof m === "string" ? { link } : m;
      const info: MemberInfo = typeof m === "string" ? { ...notes[infoKey(target)] } : inline;
      return { id: info.id || `${row.id}:${targetId(target)}`, target, link: link!, info };
    });
  }
}
