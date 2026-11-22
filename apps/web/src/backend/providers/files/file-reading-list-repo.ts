/**
 * Reading lists as `reading-lists/<slug>--<id>.list.md` files (0.9.7 L3). Each list file
 * holds the list's own fields only: name, description, parent, color and screening items.
 *
 * Membership lives on each member, in its own frontmatter (see member-frontmatter.ts):
 *
 * ```yaml
 * lists: ["[[review--l1.list]]"]
 * list-notes: {"[[review--l1.list]]": "key"}
 * ```
 *
 * `[[review--l1.list]]` is the list file's name minus `.md`, so a list renamed in
 * place keeps its file path and its members still point at it. An item's id is derived as
 * `<list id>:<paper or note id>`; its sortOrder is its index among the list's members in
 * workspace path order. Caller-supplied item ids are not stored.
 */
import {
  NotFoundError,
  type IReadingListItemRepository,
  type IReadingListRepository,
  type IWorkspaceFs,
  type ReadingList,
  type ReadingListFilter,
  type ReadingListItem,
  type ReadingListLegacyLeftover,
  type ReadingListTreeNode,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { FileEntityStore, type ProjectRoot, writeIfUnchanged } from "./file-entity-store";
import { LinkIndex, type LinkTarget } from "./link-index";
import { addListMembership, type MemberFields, listLinkFor, readMemberFields, removeListMembership } from "./member-frontmatter";
import { legacyMemberLinks, legacyNoteOf, migrateLegacyLists } from "./legacy-list-members";

/** A list row as the codec reads it; `members` and `memberNotes` are the 0.9.6 keys, read only for the rewrite. */
type ListRow = ReadingList & { members?: unknown; memberNotes?: unknown };

function targetIdOf(t: LinkTarget): string {
  return "paperId" in t ? t.paperId : t.vaultPageId;
}

function itemIdOf(listId: string, target: LinkTarget): string {
  return `${listId}:${targetIdOf(target)}`;
}

function plainList({ members: _m, memberNotes: _n, ...list }: ListRow): ReadingList {
  return list;
}

function byOrderThenName(a: ReadingList, b: ReadingList): number {
  return a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export class FileReadingListRepository implements IReadingListRepository {
  private readonly store: FileEntityStore<ListRow>;
  private readonly migrate: () => Promise<void>;

  constructor(fs: IWorkspaceFs, root: ProjectRoot) {
    this.store = new FileEntityStore<ListRow>(fs, root, "reading_list");
    this.migrate = () => migrateLegacyLists(fs, root);
  }

  async getById(id: string): Promise<ReadingList | null> {
    await this.migrate();
    const row = await this.store.get(id);
    return row ? plainList(row) : null;
  }

  async listByIds(ids: readonly string[]): Promise<ReadingList[]> {
    await this.migrate();
    const wanted = new Set(ids);
    return (await this.store.all()).filter((l) => wanted.has(l.id)).map(plainList);
  }

  async list(filter: ReadingListFilter = {}): Promise<ReadingList[]> {
    await this.migrate();
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
    await this.migrate();
    const lists = (await this.store.all()).map(plainList).sort(byOrderThenName);
    return readyCore().buildListTree(lists) as unknown as ReadingListTreeNode[];
  }

  /**
   * Writes the list's own fields under the list's id (a caller-supplied id is kept, and
   * a new one makes a new file). Membership is on the members, so a save never touches it.
   */
  async save(list: ReadingList): Promise<void> {
    await this.store.save(plainList(list as ListRow));
  }

  delete(id: string): Promise<void> {
    return this.store.delete(id);
  }
}

export class FileReadingListItemRepository implements IReadingListItemRepository {
  private readonly lists: FileEntityStore<ListRow>;
  private readonly links: LinkIndex;
  private readonly migrate: () => Promise<void>;

  constructor(
    private readonly fs: IWorkspaceFs,
    root: ProjectRoot,
  ) {
    this.lists = new FileEntityStore<ListRow>(fs, root, "reading_list");
    this.links = new LinkIndex(fs, root);
    this.migrate = () => migrateLegacyLists(fs, root);
  }

  async listItems(listId: string): Promise<ReadingListItem[]> {
    return this.listItemsForLists([listId]);
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    const wanted = new Set(listIds);
    return (await this.memberships()).items.filter((i) => wanted.has(i.listId));
  }

  async listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    return (await this.memberships()).items.filter((i) => i.paperId === paperId);
  }

  async listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    return (await this.memberships()).items.filter((i) => i.vaultPageId === vaultPageId);
  }

  /** The workspace paths whose membership values could not be read; those papers and notes are left out of the lists. */
  async unreadablePaths(): Promise<string[]> {
    return (await this.memberships()).unreadable;
  }

  /** The 0.9.6 leftovers: members that are not items (conflicting, unresolved or pending). All lists when no id is given. */
  async legacyLeftovers(listId?: string): Promise<ReadingListLegacyLeftover[]> {
    const { leftovers } = await this.memberships();
    return listId === undefined ? leftovers : leftovers.filter((l) => l.listId === listId);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    return (await this.listItems(listId)).find((i) => i.paperId === paperId) ?? null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    return (await this.listItems(listId)).find((i) => i.vaultPageId === vaultPageId) ?? null;
  }

  /** Adds the paper or note to the list (one membership per target), with its note. */
  async add(item: ReadingListItem): Promise<void> {
    const target: LinkTarget | null = item.paperId
      ? { paperId: item.paperId }
      : item.vaultPageId
        ? { vaultPageId: item.vaultPageId }
        : null;
    if (!target) throw new NotFoundError("A reading-list item needs a paper or a note.");
    const list = await this.lists.find(item.listId);
    if (!list) throw new NotFoundError(`No reading list with id "${item.listId}".`);
    const snapshot = await this.links.snapshot();
    const file = snapshot.pathFor(target);
    if (!file) throw new NotFoundError(`No file for ${"paperId" in target ? "paper" : "note"} "${targetIdOf(target)}".`);
    const text = await this.fs.readText(file);
    const next = addListMembership(text, listLinkFor(list.path), item.note);
    if (next !== text) await writeIfUnchanged(this.fs, file, next, text);
  }

  /** Removes the membership with this item id; the list file is not touched. */
  async remove(id: string): Promise<void> {
    const at = id.indexOf(":");
    if (at < 0) return;
    const list = await this.lists.find(id.slice(0, at));
    if (!list) return;
    const link = listLinkFor(list.path);
    const snapshot = await this.links.snapshot();
    for (const { target, path } of snapshot.all()) {
      if (itemIdOf(list.row.id, target) !== id) continue;
      const text = await this.fs.readText(path);
      const next = removeListMembership(text, link);
      if (next !== text) await writeIfUnchanged(this.fs, path, next, text);
    }
  }

  /**
   * Every membership of a live list, each list's members ordered by workspace path, plus the
   * paths that could not be read. A paper or note whose membership value is unreadable is left
   * out and reported; its file is not touched. A member whose link names no live list is not
   * listed; its frontmatter is kept. Legacy (0.9.6) members still in a list file are never items
   * (an item needs a paper or note id): they are leftovers, see `legacyLeftovers`.
   */
  private async memberships(): Promise<{
    items: ReadingListItem[];
    unreadable: string[];
    leftovers: ReadingListLegacyLeftover[];
  }> {
    await this.migrate();
    const files = await this.lists.readAll();
    const listIdByLink = new Map(files.map((f) => [listLinkFor(f.path), f.row.id]));
    const snapshot = await this.links.snapshot();
    const byList = new Map<string, ReadingListItem[]>();
    // A file the link scan could not read may hold memberships too: report it, never drop it silently.
    const unreadable: string[] = snapshot.unreadable.map((u) => u.path);
    for (const { target, path } of snapshot.all().sort(byPath)) {
      let fields: MemberFields;
      try {
        fields = readMemberFields(await this.fs.readText(path));
      } catch {
        unreadable.push(path);
        continue;
      }
      const { lists, listNotes } = fields;
      for (const link of new Set(lists)) {
        const listId = listIdByLink.get(link);
        if (!listId) continue;
        const item: ReadingListItem = { id: itemIdOf(listId, target), listId, ...target, sortOrder: 0 };
        const note = listNotes[link];
        if (note) item.note = note;
        byList.set(listId, [...(byList.get(listId) ?? []), item]);
      }
    }
    const leftovers: ReadingListLegacyLeftover[] = [];
    for (const file of files) {
      if (file.row.members === undefined && file.row.memberNotes === undefined) continue;
      const listId = file.row.id;
      for (const raw of legacyMemberLinks(file.row)) {
        const target = snapshot.resolve(raw);
        if (!target || !snapshot.pathFor(target)) {
          leftovers.push({ listId, state: "unresolved", legacyLink: raw });
          continue;
        }
        const note = legacyNoteOf(file.row, target);
        const noteField = note === undefined ? {} : { note };
        const item = (byList.get(listId) ?? []).find((i) => i.id === itemIdOf(listId, target));
        if (!item) leftovers.push({ listId, state: "pending", ...target, ...noteField });
        else if (note !== undefined && item.note !== note) leftovers.push({ listId, state: "conflict", ...target, note });
      }
    }
    const out: ReadingListItem[] = [];
    for (const items of byList.values()) {
      items.forEach((item, index) => (item.sortOrder = index));
      out.push(...items);
    }
    return { items: out, unreadable, leftovers };
  }
}
