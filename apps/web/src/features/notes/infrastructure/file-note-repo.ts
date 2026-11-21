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
 * - A save never overwrites a file changed since it was read.
 *
 * Canvas notes live in `.canvas` files and are not saved here.
 */
import type {
  IVaultPageRepository,
  IWorkspaceFs,
  VaultPage,
  VaultPageFilter,
  VaultPageSummary,
  VaultPageTreeNode,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { moveToTrash } from "@/lib/workspace-trash";

const TYPE = "vault_page";
const SUFFIX = ".note.md";
const PREVIEW = 200;

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

function summary({ body, ...rest }: VaultPage): VaultPageSummary {
  return { ...rest, bodyPreview: body.slice(0, PREVIEW) };
}

function byOrder(a: { sortOrder: number; title: string }, b: { sortOrder: number; title: string }): number {
  return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
}

export class FileNoteRepository implements IVaultPageRepository {
  constructor(
    private readonly fs: IWorkspaceFs,
    /** Project folder the `notes/` folder sits in ("" for the workspace root). */
    private readonly root: string,
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
    return found.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getById(id: string): Promise<VaultPage | null> {
    return (await this.readAll()).find((f) => f.page.id === id)?.page ?? null;
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

  async save(page: VaultPage): Promise<void> {
    if (page.kind === "canvas") throw new Error("Canvas notes are saved as .canvas files, not here.");
    const core = readyCore();
    const all = await this.readAll();
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
    const text = core.writeFrontmatter(fields, page.body.replace(/\r\n?/g, "\n"));
    if (text === found?.text) return;
    await this.write(path, text, found?.text ?? null);
  }

  async delete(id: string): Promise<void> {
    const found = (await this.readAll()).find((f) => f.page.id === id);
    // To the trash, like a paper: a note is the user's file and a delete must be undoable.
    if (found) await moveToTrash(this.fs, found.path, Date.now());
  }

  private async write(path: string, text: string, expected: string | null): Promise<void> {
    if (!this.fs.writeTextIf) return this.fs.writeFile(path, text);
    if (!(await this.fs.writeTextIf(path, text, expected))) {
      throw new Error(`${path} changed on disk; reload before saving.`);
    }
  }
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
