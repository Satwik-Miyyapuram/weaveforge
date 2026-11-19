import type {
  IPaperRepository,
  IWorkspaceFs,
  Paper,
  PaperFilter,
  PaperIdentity,
  PaperSummary,
} from "@weaveforge/core";
import { ConflictError } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

/** A paper file as read from the folder. */
interface PaperFileRead {
  path: string;
  text: string;
  paper: Paper;
}

/** How often a write re-reads and tries again when the file changed under it. */
const WRITE_ATTEMPTS = 3;
/** How many numbered trash names (`x.paper.md`, `x-2.paper.md`, …) a delete tries. */
const TRASH_NAME_ATTEMPTS = 1000;

/**
 * Papers as workspace files (files-first L1): one `<slug>--<id>.paper.md` per paper
 * under `<project>/papers/`, with the paper's fields in frontmatter and the reader's
 * notes as the body. No database.
 *
 * Parsing and writing are the Rust `paperRowFromFile` / `writePaperRow`, so a write
 * keeps the body, relations and every key the app does not own. A file that is not
 * a paper, or is from a newer app, is skipped on read and refused on write.
 *
 * Each call reads the folder; the desktop index (`index_list("paper", …)`) is the
 * faster path once the bridge exposes it.
 */
export class FilePaperRepository implements IPaperRepository {
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly projectRoot: string,
  ) {}

  async getById(id: string): Promise<Paper | null> {
    return (await this.find((paper) => paper.id === id))?.paper ?? null;
  }

  async list(filter?: PaperFilter): Promise<Paper[]> {
    let items = (await this.readAll()).map((read) => read.paper);
    if (filter?.status) items = items.filter((p) => p.status === filter.status);
    if (filter?.titleContains) {
      const needle = filter.titleContains.toLowerCase();
      items = items.filter((p) => p.title.toLowerCase().includes(needle));
    }
    if (filter?.arxivId) items = items.filter((p) => p.arxivId === filter.arxivId);
    if (filter?.doi) {
      const doi = typedCore().normalizeDoi(filter.doi);
      items = items.filter((p) => p.doi === doi);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listSummaries(): Promise<PaperSummary[]> {
    return this.list();
  }

  async findByArxivId(arxivId: string): Promise<Paper | null> {
    return (await this.find((paper) => paper.arxivId === arxivId))?.paper ?? null;
  }

  async findByDoi(doi: string): Promise<Paper | null> {
    const target = typedCore().normalizeDoi(doi);
    return (await this.find((paper) => paper.doi === target))?.paper ?? null;
  }

  async findByTitleKey(key: string): Promise<Paper | null> {
    const core = typedCore();
    return (await this.find((paper) => core.titleKey(paper.title) === key))?.paper ?? null;
  }

  async findIdentityByArxivId(arxivId: string): Promise<PaperIdentity | null> {
    return identityOf(await this.findByArxivId(arxivId));
  }

  async findIdentityByDoi(doi: string): Promise<PaperIdentity | null> {
    return identityOf(await this.findByDoi(doi));
  }

  async save(entity: Paper): Promise<void> {
    await this.write(entity.id, () => toRow(entity), true);
  }

  async setTags(id: string, tags: string[], updatedAt: string): Promise<void> {
    await this.write(id, (current) => current && { ...toRow(current), tags: [...tags], updatedAt }, false);
  }

  async replaceSummary(
    id: string,
    expected: string | undefined,
    next: string,
    updatedAt: string,
  ): Promise<boolean> {
    const read = await this.findById(id);
    if (!read || (read.paper.summary || undefined) !== (expected || undefined)) return false;
    const row = { ...toRow(read.paper), summary: next || undefined, updatedAt };
    const text = typedCore().writePaperRow(read.text, stripUndefined(row));
    return this.writeIf(read.path, text, read.text);
  }

  /** Moves the paper's file to `.weaveforge/trash/<day>/<path>`; never unlinks it. */
  async delete(id: string): Promise<void> {
    const read = await this.findById(id);
    if (read) await this.moveToTrash(read.path);
  }

  /**
   * Writes the row `rowFor` gives for the paper's current state. When the file
   * changed between the read and the write, reads again and re-applies, so an edit
   * made outside the app to anything the row does not carry is kept.
   */
  private async write(
    id: string,
    rowFor: (current: Paper | null) => Record<string, unknown> | null,
    create: boolean,
  ): Promise<void> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const read = await this.findById(id);
      if (!read && !create) return;
      const row = rowFor(read?.paper ?? null);
      if (!row) return;
      const text = typedCore().writePaperRow(read?.text ?? null, stripUndefined(row));
      const path = read?.path ?? this.newPath(id, String(row.title ?? ""));
      if (await this.writeIf(path, text, read?.text ?? null)) return;
    }
    throw new ConflictError(`Paper ${id} kept changing on disk; not saved.`);
  }

  private newPath(id: string, title: string): string {
    return typedCore().flatPath("paper", id, title, this.projectRoot);
  }

  /** Writes only if the file is still `expected`; without `writeTextIf` it refuses. */
  private async writeIf(path: string, text: string, expected: string | null): Promise<boolean> {
    if (!this.fs.writeTextIf) {
      throw new Error(`${path}: this workspace has no conditional write; not saved.`);
    }
    if (expected === null) await this.fs.mkdirp(parentOf(path));
    return this.fs.writeTextIf(path, text, expected);
  }

  /** Renames `path` to the first free trash name for today (`-2`, `-3`, … on a clash). */
  private async moveToTrash(path: string): Promise<void> {
    const core = typedCore();
    const now = Date.now();
    for (let n = 1; n <= TRASH_NAME_ATTEMPTS; n += 1) {
      const target = core.trashPathFor(path, now, n);
      if (await this.fs.stat(target)) continue;
      await this.fs.mkdirp(parentOf(target));
      await this.fs.rename(path, target);
      return;
    }
    throw new ConflictError(`${path}: no free name in the trash; not deleted.`);
  }

  private async find(match: (paper: Paper) => boolean): Promise<PaperFileRead | null> {
    return (await this.readAll()).find((read) => match(read.paper)) ?? null;
  }

  /** The file of paper `id`; refuses when more than one file claims that id. */
  private async findById(id: string): Promise<PaperFileRead | null> {
    const reads = (await this.readAll()).filter((read) => read.paper.id === id);
    if (reads.length > 1) {
      throw new ConflictError(
        `Paper ${id} is in more than one file (${reads.map((read) => read.path).join(", ")}); not saved.`,
      );
    }
    return reads[0] ?? null;
  }

  /** Every readable paper file under `<project>/papers/`, in walk order. */
  private async readAll(): Promise<PaperFileRead[]> {
    const core = typedCore();
    const dir = core.entityDir("paper", this.projectRoot);
    if (!(await this.fs.stat(dir))) return [];
    const reads: PaperFileRead[] = [];
    for await (const entry of this.fs.walk(dir)) {
      if (!entry.path.endsWith(".paper.md")) continue;
      const text = await this.fs.readText(entry.path);
      try {
        reads.push({ path: entry.path, text, paper: fromRow(core.paperRowFromFile(text)) });
      } catch {
        // Not a paper file: shown by the index, never written by this repository.
      }
    }
    return reads;
  }
}

/** A paper as the row the Rust writer takes: absent fields are left out. */
function toRow(paper: Paper): Record<string, unknown> {
  return stripUndefined({ ...paper });
}

function stripUndefined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

/** The row a file holds as a `Paper`; a file without stamps sorts first. */
function fromRow(row: Record<string, unknown>): Paper {
  return { createdAt: "", updatedAt: "", ...row } as unknown as Paper;
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function identityOf(paper: Paper | null): PaperIdentity | null {
  return paper ? { id: paper.id, title: paper.title, status: paper.status } : null;
}
