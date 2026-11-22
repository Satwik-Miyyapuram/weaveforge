/**
 * Reading lists as `reading-lists/<slug>--<id>.list.md` files (0.9.7 L3), with
 * membership as tags on the members (0.9.8). Same contract as the `reading_lists` /
 * `reading_list_items` repos; laws in test/file-reading-list-repo.test.ts.
 *
 * A paper or note is in a list when its file carries `lists: ["[[<list file name>]]"]`.
 * What the app knows about that membership sits beside the tag, keyed by list id:
 *
 * ```yaml
 * lists: ["[[Review]]"]
 * list-notes: {"<list id>": {"id":"i2","order":1,"note":"key","from":"l0"}}
 * ```
 *
 * A tag with no `list-notes` entry has the id `<list id>:<paper or note id>` and its
 * order as its sort. Editing an item writes only the member file, never the list file.
 *
 * The older `members` array in a list file still reads, after the tags, for members
 * whose paper or note has no tag in that list. It is read-only: removing one is refused,
 * and adding the same paper or note writes a tag that overrides it. Every other field of
 * the list file (the old `members`, screening `items`, unknown keys) is kept on save.
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
import { LinkIndex, type LinkTarget, type Links } from "./link-index";
import {
  editMemberFile,
  listFileOf,
  objectOf,
  readTagged,
  withTag,
  withoutTag,
  type ListFile,
  type MemberInfo,
} from "./reading-list-tags";

/** The Postgres foreign-key code the service reads as "the `from` list is gone". */
const INHERITED_LINK_CODE = "23503";

/** One membership: a list, a paper or note in it, and what the app knows about it. */
interface Membership {
  list: ListFile;
  target: LinkTarget;
  info: MemberInfo;
  /** The member file, when the membership is a tag (legacy memberships have none). */
  file?: string;
  /** Its place in the list file's legacy `members`. */
  index?: number;
}

/** A legacy `members` entry: a plain link, or the older object form with its info. */
interface LegacyMember {
  link: string;
  info: MemberInfo;
}

function targetId(t: LinkTarget): string {
  return "paperId" in t ? t.paperId : t.vaultPageId;
}

function sameTarget(a: LinkTarget, b: LinkTarget): boolean {
  return ("paperId" in a) === ("paperId" in b) && targetId(a) === targetId(b);
}

function targetKey(t: LinkTarget): string {
  return `${"paperId" in t ? "paper" : "note"}:${targetId(t)}`;
}

function memberId(m: Membership): string {
  return m.info.id || `${m.list.id}:${targetId(m.target)}`;
}

function byOrderThenName(a: ReadingList, b: ReadingList): number {
  return a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** The legacy `members` of a list file's text, in file order. */
function legacyMembers(text: string): LegacyMember[] {
  const members = (readyCore().readFrontmatter(text).frontmatter as { members?: unknown }).members;
  if (!Array.isArray(members)) return [];
  const out: LegacyMember[] = [];
  for (const m of members) {
    // The object form reads back as its JSON text (see objectOf).
    const object = objectOf(m);
    if (object) {
      const { link, ...info } = object as MemberInfo & { link?: unknown };
      if (typeof link === "string") out.push({ link, info });
    } else if (typeof m === "string") out.push({ link: m, info: {} });
  }
  return out;
}

function toItem(m: Membership, live: ReadonlySet<string>): ReadingListItem {
  const { info } = m;
  const item: ReadingListItem = {
    id: memberId(m),
    listId: m.list.id,
    ...m.target,
    sortOrder: typeof info.order === "number" ? info.order : (m.index ?? 0),
  };
  if (info.note) item.note = info.note;
  if (info.from && live.has(info.from)) item.inheritedFromListId = info.from;
  if (info["duplicate-of"]) item.duplicateOfItemId = info["duplicate-of"];
  return item;
}

export class FileReadingListRepository implements IReadingListRepository {
  private readonly store: FileEntityStore<ReadingList>;

  constructor(fs: IWorkspaceFs, root: ProjectRoot) {
    this.store = new FileEntityStore<ReadingList>(fs, root, "reading_list");
  }

  getById(id: string): Promise<ReadingList | null> {
    return this.store.get(id);
  }

  async listByIds(ids: readonly string[]): Promise<ReadingList[]> {
    const wanted = new Set(ids);
    return (await this.store.all()).filter((l) => wanted.has(l.id));
  }

  async list(filter: ReadingListFilter = {}): Promise<ReadingList[]> {
    const needle = filter.nameContains?.toLowerCase();
    return (await this.store.all())
      .filter(
        (l) =>
          (filter.parentId === undefined || (l.parentId ?? null) === filter.parentId) &&
          (!needle || l.name.toLowerCase().includes(needle)),
      )
      .sort(byOrderThenName);
  }

  async getTree(): Promise<ReadingListTreeNode[]> {
    const lists = (await this.store.all()).sort(byOrderThenName);
    return readyCore().buildListTree(lists) as unknown as ReadingListTreeNode[];
  }

  /** Writes the list's own fields; the list file's members and other keys are kept. */
  save(list: ReadingList): Promise<void> {
    return this.store.save(list);
  }

  delete(id: string): Promise<void> {
    return this.store.delete(id);
  }
}

export class FileReadingListItemRepository implements IReadingListItemRepository {
  private readonly store: FileEntityStore<ReadingList>;
  private readonly links: LinkIndex;

  constructor(private readonly fs: IWorkspaceFs, root: ProjectRoot) {
    this.store = new FileEntityStore<ReadingList>(fs, root, "reading_list");
    this.links = new LinkIndex(fs, root);
  }

  listItems(listId: string): Promise<ReadingListItem[]> {
    return this.items((m) => m.list.id === listId);
  }

  listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    const wanted = new Set(listIds);
    return this.items((m) => wanted.has(m.list.id));
  }

  listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    return this.items((m) => "paperId" in m.target && m.target.paperId === paperId);
  }

  listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    return this.items((m) => "vaultPageId" in m.target && m.target.vaultPageId === vaultPageId);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    return (await this.listItems(listId)).find((i) => i.paperId === paperId) ?? null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    return (await this.listItems(listId)).find((i) => i.vaultPageId === vaultPageId) ?? null;
  }

  /** Upsert by the paper or note: one membership per target in a list. */
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
    const { links, memberships } = await this.load();
    const file = links.fileFor(target);
    if (!file) throw new NotFoundError(`No file for ${"paperId" in target ? "paper" : "note"} "${targetId(target)}".`);

    const list = listFileOf(found.path, found.row.id);
    const info: MemberInfo = { id: item.id, order: item.sortOrder };
    if (item.note) info.note = item.note;
    if (item.inheritedFromListId) info.from = item.inheritedFromListId;
    if (item.duplicateOfItemId) info["duplicate-of"] = item.duplicateOfItemId;

    // An item id names one membership in a list: another target's tag with it is dropped.
    for (const m of memberships) {
      if (m.file && m.list.id === list.id && m.info.id === item.id && !sameTarget(m.target, target)) {
        await editMemberFile(this.fs, m.file, (f) => withoutTag(f, list));
      }
    }
    await editMemberFile(this.fs, file, (f) => withTag(f, list, info));
  }

  /** Drops one membership by item id. A legacy `members` entry is read-only and refused. */
  async remove(id: string): Promise<void> {
    const { memberships } = await this.load();
    const hit = memberships.find((m) => memberId(m) === id);
    if (!hit) return;
    if (!hit.file) {
      throw new Error(
        `The member "${targetId(hit.target)}" of reading list "${hit.list.id}" is in the list file's members, which is read-only; remove it in the list file.`,
      );
    }
    const list = hit.list;
    await editMemberFile(this.fs, hit.file, (f) => withoutTag(f, list));
  }

  private async items(match: (m: Membership) => boolean): Promise<ReadingListItem[]> {
    const { live, memberships } = await this.load();
    return memberships
      .filter(match)
      .map((m) => toItem(m, live))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Every membership: the tags on member files, then each list file's legacy members
   * whose paper or note has no tag in that list. One scan per call.
   */
  private async load(): Promise<{ live: Set<string>; links: Links; memberships: Membership[] }> {
    const lists = await this.store.readAll();
    const live = new Set(lists.map((f) => f.row.id));
    const files = lists.map((f) => listFileOf(f.path, f.row.id));
    const links = await this.links.snapshot();
    const tagged = await readTagged(this.fs, links, files);
    const memberships: Membership[] = tagged.map((t) => ({ list: t.list, target: t.target, info: t.info, file: t.file }));
    // One membership per target in a list: a tag wins, then the first legacy entry for the target.
    const seen = new Set(tagged.map((t) => `${t.list.id}|${targetKey(t.target)}`));
    for (const f of lists) {
      const list = listFileOf(f.path, f.row.id);
      legacyMembers(f.text).forEach((m, index) => {
        const target = links.resolve(m.link);
        const key = `${list.id}|${target ? targetKey(target) : ""}`;
        if (!target || seen.has(key)) return;
        seen.add(key);
        memberships.push({ list, target, info: m.info, index });
      });
    }
    return { live, links, memberships };
  }
}
