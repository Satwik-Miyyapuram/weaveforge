/**
 * Notes as workspace files (0.9.5 files-first, L3): one
 * `<root>/notes/<slug>--<id-suffix>.note.md` per note, frontmatter `title`,
 * `parent`, `order`, `pinned`, `folder`, `created-at`, `updated-at`; the body
 * is the markdown.
 *
 * Laws (proved in test/file-note-repo.test.ts):
 * - A saved note reads back unchanged, an empty body included.
 * - CRLF in a body is stored as LF, once: saving the same note again writes nothing.
 * - Changing only `sortOrder` changes only the `order` line.
 * - A save that would make a note its own ancestor is refused and writes nothing.
 * - A save keeps the path and every field it does not own.
 * - A save never overwrites a file changed since it was read; a stale `save` puts the page in a conflict copy.
 * - `add` and `update` refuse a blank title or another note's title, as the Rust repo does.
 * - A guarded `update` (one with `baseBody`) never drops an outside edit: the
 *   file's text is kept as a conflict copy, then the caller's text is written.
 *
 * Canvas notes live in `.canvas` files and are not saved here.
 */
import {
  ConflictError,
  NotFoundError,
  VaultPageValidationError,
  type EditVaultPageInput,
  type EditedVaultPage,
  type IVaultPageManager,
  type IVaultPageRepository,
  type IWorkspaceFs,
  type NewVaultPageInput,
  type VaultPage,
  type VaultPageFilter,
  type VaultPageSummary,
  type VaultPageTreeNode,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { moveToTrash } from "@/lib/workspace-trash";

const TYPE = "vault_page";
const SUFFIX = ".note.md";
const PREVIEW = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATED = /^\d{4}-\d{2}-\d{2}/;
/** A guarded update re-reads and re-plans this many times when the file keeps changing under it. */
const ATTEMPTS = 3;

/** The file changed between the read and the checked write. */
class ChangedOnDiskError extends Error {}

interface Found {
  path: string;
  text: string;
  page: VaultPage;
}

function parse(path: string, text: string): Found | null {
  const core = readyCore();
  const { frontmatter, body } = core.readFrontmatter(text);
  const field = (key: string) => core.frontmatterString(frontmatter, key);
  const id = field("weaveforge-id");
  if (!id || field("weaveforge-type") !== TYPE) return null;
  const page: VaultPage = {
    id,
    title: field("title") ?? id,
    body,
    sortOrder: Number(field("order") ?? 0) || 0,
    createdAt: field("created-at") ?? "",
    updatedAt: field("updated-at") ?? "",
  };
  const parent = field("parent");
  if (parent) page.parentId = parent;
  if (field("pinned") === "true") page.pinned = true;
  if (field("folder") === "true") page.folder = true;
  return { path, text, page };
}

/** The fields this repo owns, in a fixed order, so two pages compare by what the file stores. */
function owned(p: VaultPage): string {
  return JSON.stringify([p.title, lf(p.body), p.parentId ?? null, p.sortOrder, !!p.pinned, !!p.folder, p.createdAt, p.updatedAt]);
}

/**
 * True when the page in `found` is no longer the one the caller started from: `seen` when given, else the
 * page in `loadedText` (what this repo last read or wrote). Keys the repo does not own never count.
 */
function changedSince(found: Found, seen: VaultPage | undefined, loadedText: string | undefined): boolean {
  if (seen !== undefined) return owned(seen) !== owned(found.page);
  if (loadedText === undefined || loadedText === found.text) return false;
  const before = parse(found.path, loadedText)?.page;
  return JSON.stringify(before) !== JSON.stringify(found.page);
}

function summary({ body, ...rest }: VaultPage): VaultPageSummary {
  return { ...rest, bodyPreview: body.slice(0, PREVIEW) };
}

function byOrder(a: { sortOrder: number; title: string }, b: { sortOrder: number; title: string }): number {
  return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
}

export class FileNoteRepository implements IVaultPageRepository, IVaultPageManager {
  /** Per id, the file text this repo last read or wrote: `save` expects the file to still hold that page. */
  private readonly loaded = new Map<string, string>();
  /** Per page id, the conflict copy this repo last wrote for it, its base and its file text: a retry from that base reuses it. */
  private readonly copies = new Map<string, { id: string; base: string; text: string }>();

  constructor(
    private readonly fs: IWorkspaceFs,
    /** Project folder the `notes/` folder sits in ("" for the workspace root). */
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private get dir(): string {
    return this.root ? `${this.root}/notes` : "notes";
  }

  private async readAll(): Promise<Found[]> {
    if (!(await this.fs.stat(this.dir))) return [];
    const found: Found[] = [];
    for await (const entry of this.fs.walk(this.dir)) {
      if (!entry.path.endsWith(SUFFIX)) continue;
      const parsed = parse(entry.path, await this.fs.readText(entry.path));
      if (parsed) found.push(parsed);
    }
    found.sort((a, b) => a.path.localeCompare(b.path));
    // Two files can carry one id (a copied file, an old mirror's twin): the first one is the note, as `find` reads it.
    const ids = new Set<string>();
    for (const f of found) {
      if (ids.has(f.page.id)) continue;
      ids.add(f.page.id);
      this.loaded.set(f.page.id, f.text);
    }
    return found;
  }

  async getById(id: string): Promise<VaultPage | null> {
    return (await this.readAll()).find((f) => f.page.id === id)?.page ?? null;
  }

  /** The file that holds note `id`, or null. */
  async pathOf(id: string): Promise<string | null> {
    return (await this.readAll()).find((f) => f.page.id === id)?.path ?? null;
  }

  async list(filter: VaultPageFilter = {}): Promise<VaultPage[]> {
    const needle = filter.query?.toLowerCase();
    return (await this.readAll())
      .map((f) => f.page)
      .filter((p) => filter.parentId === undefined || (p.parentId ?? null) === filter.parentId)
      .filter((p) => !needle || `${p.title}\n${p.body}`.toLowerCase().includes(needle));
  }

  async listSummaries(): Promise<VaultPageSummary[]> {
    return (await this.list()).map(summary);
  }

  async getTree(): Promise<VaultPageTreeNode<VaultPageSummary>[]> {
    const pages = (await this.listSummaries()).sort(byOrder);
    const nodes = new Map(pages.map((page) => [page.id, { page, children: [] as VaultPageTreeNode<VaultPageSummary>[] }]));
    const roots: VaultPageTreeNode<VaultPageSummary>[] = [];
    for (const page of pages) {
      const node = nodes.get(page.id);
      const parent = page.parentId ? nodes.get(page.parentId) : undefined;
      if (node) (parent ? parent.children : roots).push(node);
    }
    return roots;
  }

  async titleTaken(title: string, exceptId?: string): Promise<boolean> {
    const key = readyCore().normalizeTitleKey(title);
    return (await this.list()).some((p) => p.id !== exceptId && readyCore().normalizeTitleKey(p.title) === key);
  }

  /**
   * Writes the whole page. The page in the file must still be `seen`, the page as the caller read it;
   * without it, the one this repo last read or wrote (any read refreshes that, so callers that hold a page
   * for a while should pass `seen`). If another writer changed it, that edit is kept, this page goes to a
   * conflict copy (one per page: a retry updates it), and the save fails with ConflictError until the page
   * is read again. Keys the repo does not own never count.
   */
  async save(page: VaultPage, seen?: VaultPage): Promise<void> {
    const loadedText = this.loaded.get(page.id);
    // A copy is reused only by a retry from the same base with the same title.
    const base = `${seen === undefined ? (loadedText ?? "") : owned(seen)}\n${page.title}`;
    const all = await this.readAll();
    const found = all.find((f) => f.page.id === page.id);
    const conflict = async (path: string): Promise<never> => {
      await this.keepConflictCopy(await this.readAll(), page, base);
      if (loadedText !== undefined) this.loaded.set(page.id, loadedText);
      throw new ConflictError(`${path} changed on disk; your version was kept as a conflict copy. Reload before saving.`);
    };
    if (found && changedSince(found, seen, loadedText)) return conflict(found.path);
    try {
      await this.put(all, page);
    } catch (error) {
      // Another writer got in between the read and the write: their edit stays, this page goes to a copy.
      if (found && error instanceof ChangedOnDiskError) return conflict(found.path);
      throw error;
    }
    this.copies.delete(page.id);
  }

  /**
   * Keeps `page` in its conflict copy: the one this repo wrote last for that page, when it came from the same
   * `base` and the file still holds what was written (the same body is not written again), else a new copy.
   * A copy edited or removed since, or from another base, is left alone.
   */
  private async keepConflictCopy(all: readonly Found[], page: VaultPage, base: string): Promise<void> {
    const last = this.copies.get(page.id);
    const held = last && last.base === base && all.find((f) => f.page.id === last.id);
    if (last && held && held.text === last.text) {
      const body = lf(page.body);
      if (held.page.body !== body) await this.put(all, { ...held.page, body, updatedAt: this.now() });
      this.copies.set(page.id, { id: last.id, base, text: this.loaded.get(last.id) ?? held.text });
      return;
    }
    const id = await this.conflictCopy(all, page);
    const text = this.loaded.get(id);
    if (text !== undefined) this.copies.set(page.id, { id, base, text });
  }

  async add(input: NewVaultPageInput): Promise<VaultPage> {
    if (input.kind === "canvas") throw new Error("Canvas notes are saved as .canvas files, not here.");
    const title = input.title.trim();
    if (!title) throw new VaultPageValidationError("Page title is required.");
    const all = await this.readAll();
    if (input.parentId && !all.some((f) => f.page.id === input.parentId)) {
      throw new NotFoundError(`No vault page with id "${input.parentId}".`);
    }
    if (input.id !== undefined) {
      if (!UUID.test(input.id)) {
        throw new VaultPageValidationError(`The file's weaveforge-id "${input.id}" is not a valid id.`);
      }
      if (all.some((f) => f.page.id === input.id)) {
        throw new VaultPageValidationError(`Another note already has the id "${input.id}"; the file was not imported.`);
      }
    }
    if (taken(all, title)) throw new VaultPageValidationError(`A note titled “${title}” already exists.`);
    const now = this.now();
    const page: VaultPage = {
      id: input.id ?? crypto.randomUUID(),
      title,
      body: lf(input.body ?? ""),
      sortOrder: input.sortOrder ?? 0,
      createdAt: input.createdAt && DATED.test(input.createdAt) ? input.createdAt : now,
      updatedAt: now,
    };
    if (input.parentId) page.parentId = input.parentId;
    if (input.folder) page.folder = true;
    await this.put(all, page);
    return page;
  }

  async update(id: string, input: EditVaultPageInput): Promise<EditedVaultPage> {
    const core = readyCore();
    const copies: string[] = [];
    /** Outside texts already kept as a copy, so a retry does not copy them twice. */
    const kept = new Set<string>();
    for (let attempt = 1; ; attempt += 1) {
      const all = await this.readAll();
      const old = all.find((f) => f.page.id === id)?.page;
      if (!old) throw new NotFoundError(`No vault page with id "${id}".`);
      const title = input.title === undefined ? old.title : input.title.trim();
      if (!title) throw new VaultPageValidationError("Page title is required.");
      if (core.normalizeTitleKey(title) !== core.normalizeTitleKey(old.title) && taken(all, title, id)) {
        throw new VaultPageValidationError(`A note titled “${title}” already exists.`);
      }
      if (typeof input.parentId === "string") {
        if (!all.some((f) => f.page.id === input.parentId)) {
          throw new NotFoundError(`No vault page with id "${input.parentId}".`);
        }
        if (makesCycle(all, id, input.parentId)) {
          throw new VaultPageValidationError("A note cannot be moved inside itself.");
        }
      }
      const next: VaultPage = { ...old, title };
      if (input.body !== undefined) {
        const mine = lf(input.body);
        const theirs = old.body;
        const outside =
          input.baseBody !== undefined &&
          theirs !== mine &&
          theirs !== lf(input.baseBody) &&
          !(input.sessionDigests ?? []).includes(core.digestText(theirs));
        if (outside && !kept.has(theirs)) {
          copies.push(await this.conflictCopy(all, old));
          kept.add(theirs);
        }
        next.body = mine;
      }
      if (input.parentId === null) delete next.parentId;
      else if (input.parentId !== undefined) next.parentId = input.parentId;
      if (input.pinned === true) next.pinned = true;
      else if (input.pinned === false) delete next.pinned;
      if (
        next.title === old.title &&
        next.body === old.body &&
        next.parentId === old.parentId &&
        next.pinned === old.pinned
      ) {
        return withCopies(old, copies);
      }
      next.updatedAt = this.now();
      try {
        await this.put(all, next);
        return withCopies(next, copies);
      } catch (error) {
        // Unguarded, a changed file is refused as `save` refuses it. Guarded,
        // re-read: the outside text is then kept as a copy before mine is written.
        if (!(error instanceof ChangedOnDiskError) || input.baseBody === undefined || attempt >= ATTEMPTS) throw error;
      }
    }
  }

  async remove(id: string): Promise<void> {
    await this.delete(id);
  }

  /** Saves `of`'s current text as a new note beside it, titled as the Rust guard titles it; returns its id. */
  private async conflictCopy(all: readonly Found[], of: VaultPage): Promise<string> {
    const now = this.now();
    const id = crypto.randomUUID();
    const base = `${of.title} (conflict copy ${now.slice(0, 19).replace("T", " ")})`;
    const title = [base, `${base} ${id.slice(0, 8)}`].find((t) => !taken(all, t)) ?? `${base} ${id}`;
    const copy: VaultPage = { id, title, body: of.body, sortOrder: of.sortOrder, createdAt: now, updatedAt: now };
    if (of.parentId) copy.parentId = of.parentId;
    await this.put(all, copy);
    return id;
  }

  /** Writes `page` over the file `all` read for it; throws ChangedOnDiskError when that file changed since. */
  private async put(all: readonly Found[], page: VaultPage): Promise<void> {
    if (page.kind === "canvas") throw new Error("Canvas notes are saved as .canvas files, not here.");
    const core = readyCore();
    if (makesCycle(all, page.id, page.parentId)) {
      throw new Error(`Moving "${page.title}" there would make a parent cycle.`);
    }
    const found = all.find((f) => f.page.id === page.id);
    const path = found?.path ?? core.flatPath(TYPE, page.id, page.title, this.root);
    const old = found ? core.readFrontmatter(found.text).frontmatter : {};
    const fields: Record<string, unknown> = {
      "weaveforge-id": page.id,
      "weaveforge-type": TYPE,
      ...old,
      title: page.title,
      parent: page.parentId,
      order: page.sortOrder,
      pinned: page.pinned || undefined,
      folder: page.folder || undefined,
      "created-at": page.createdAt,
      "updated-at": page.updatedAt,
    };
    const text = core.writeFrontmatter(fields, lf(page.body));
    if (text === found?.text) return;
    await this.write(path, text, found?.text ?? null);
    this.loaded.set(page.id, text);
  }

  async delete(id: string): Promise<void> {
    // To the trash, like a paper: a note is the user's file and a delete must be undoable.
    // Every file carrying the id goes: a twin left behind would bring the note back.
    for (const found of (await this.readAll()).filter((f) => f.page.id === id)) {
      await moveToTrash(this.fs, found.path, Date.now());
    }
    this.loaded.delete(id);
  }

  private async write(path: string, text: string, expected: string | null): Promise<void> {
    if (!this.fs.writeTextIf) throw new Error(`${path}: this workspace cannot save without overwriting outside edits.`);
    if (!(await this.fs.writeTextIf(path, text, expected))) {
      throw new ChangedOnDiskError(`${path} changed on disk; reload before saving.`);
    }
  }
}

function lf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** True when a note other than `exceptId` has `title`, case and spacing folded. */
function taken(all: readonly Found[], title: string, exceptId?: string): boolean {
  const core = readyCore();
  const key = core.normalizeTitleKey(title);
  return all.some((f) => f.page.id !== exceptId && core.normalizeTitleKey(f.page.title) === key);
}

function withCopies(page: VaultPage, copies: readonly string[]): EditedVaultPage {
  if (copies.length === 0) return page;
  return { ...page, conflictCopyId: copies[copies.length - 1], conflictCopyIds: [...copies] };
}

/** True when giving `id` the parent `parentId` would make it its own ancestor. */
function makesCycle(all: readonly Found[], id: string, parentId: string | undefined): boolean {
  const parents = new Map(all.map((f) => [f.page.id, f.page.parentId]));
  const seen = new Set<string>();
  for (let at = parentId; at !== undefined; at = parents.get(at)) {
    if (at === id) return true;
    if (seen.has(at)) return false;
    seen.add(at);
  }
  return false;
}
