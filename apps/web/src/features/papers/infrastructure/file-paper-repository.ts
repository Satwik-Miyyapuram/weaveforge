import type {
  IPaperRepository,
  IWorkspaceFs,
  Paper,
  PaperFilter,
  PaperIdentity,
  PaperSummary,
} from "@weaveforge/core";
import { ConflictError, isSafeWorkspacePath } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";
import { moveToTrash } from "@/lib/workspace-trash";

/** A paper file's `relations` (outgoing, `to` a `[[link]]` or id) and custom `fields`. */
export interface PaperExtras {
  relations: { to: string; type: string; [key: string]: unknown }[];
  fields: Record<string, unknown>;
}

/** A paper file as read from the folder. */
interface PaperFileRead {
  path: string;
  text: string;
  paper: Paper;
}

/** A `.paper.md` file the repository could not read, and why. */
export interface PaperFileFailure {
  path: string;
  error: string;
}

/** Options for {@link FilePaperRepository}. */
export interface FilePaperRepositoryOptions {
  /**
   * Write `weaveforge-id` into new files (default true). When false a new file
   * carries no id and the paper is known by its path; the id the caller passed to
   * `save` is then not kept, so only use it once nothing keys data by paper id.
   */
  writeIds?: boolean;
}

/** How often a write re-reads and tries again when the file changed under it. */
const WRITE_ATTEMPTS = 3;
/** How many numbered names (`x`, `x-2`, …) a new file or a trash move tries. */
const NAME_ATTEMPTS = 1000;
const PAPER_SUFFIX = ".paper.md";

/**
 * Papers as workspace files (files-first L1): one `<title slug>.paper.md` per paper
 * under `<project>/papers/` (`-2`, `-3`, … when two papers share a title), with the
 * paper's fields in frontmatter and the reader's notes as the body. No database.
 *
 * A paper is identified by its file: its id is the file's `weaveforge-id` when it
 * has one, else the file's path. The file name never holds an id.
 *
 * Parsing and writing are the Rust `paperRowFromFile` / `writePaperRow`, so a write
 * keeps the body, line endings, relations and every key the app does not own. A
 * file that is not a paper is left out of reads and reported by `failures()`; one
 * from a newer app is refused on write.
 *
 * Each call reads the folder; the desktop index (`index_list("paper", …)`) is the
 * faster path once the bridge exposes it.
 */
export class FilePaperRepository implements IPaperRepository {
  private readonly writeIds: boolean;

  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly projectRoot: string,
    options: FilePaperRepositoryOptions = {},
  ) {
    this.writeIds = options.writeIds ?? true;
  }

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
    return items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
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

  /** The file that holds paper `id`, or null; refuses when more than one does. */
  async pathOf(id: string): Promise<string | null> {
    return (await this.findById(id))?.path ?? null;
  }

  /** Every `.paper.md` file that could not be read as a paper, with the reason. */
  async failures(): Promise<PaperFileFailure[]> {
    return (await this.scan()).failures;
  }

  async save(entity: Paper): Promise<void> {
    await this.write(entity.id, () => toRow(entity), true);
  }

  async setTags(id: string, tags: string[], updatedAt: string): Promise<void> {
    await this.write(id, (current) => current && { ...toRow(current), tags: [...tags], updatedAt }, false);
  }

  /** Every paper's `relations` and `fields` frontmatter (Rust `paperExtrasFromFile`). */
  async listExtras(): Promise<{ paperId: string; extras: PaperExtras }[]> {
    const core = typedCore();
    return (await this.readAll()).map((read) => ({ paperId: read.paper.id, extras: core.paperExtrasFromFile(read.text) }));
  }

  /**
   * Rewrites paper `id`'s `relations` and/or `fields` to what `change` returns from
   * the current ones; every other key and the body are kept. False when no file
   * holds the paper. Re-reads and re-applies when the file changed under it.
   */
  async updateExtras(
    id: string,
    change: (current: PaperExtras) => Partial<PaperExtras> | Promise<Partial<PaperExtras>>,
  ): Promise<boolean> {
    const core = typedCore();
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const read = await this.findById(id);
      if (!read) return false;
      const text = core.writePaperExtras(read.text, await change(core.paperExtrasFromFile(read.text)));
      if (text === read.text || (await this.writeIf(read.path, text, read.text))) return true;
    }
    throw new ConflictError(`Paper ${id} kept changing on disk; not saved.`);
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

  /**
   * Moves the paper's file, its annotations and comments sidecars and its PDF to
   * `.weaveforge/trash/<day>/<path>`, all under one day; never unlinks. The PDF is
   * left when another paper still points at it, a paper file cannot be read, or it
   * is not a workspace path.
   */
  async delete(id: string): Promise<void> {
    const read = await this.findById(id);
    if (!read) return;
    const core = typedCore();
    const now = Date.now();
    await moveToTrash(this.fs, read.path, now);
    for (const sidecar of [core.annotationsFilePath(read.path), core.commentsFilePath(read.path)]) {
      if (await this.fs.stat(sidecar)) await moveToTrash(this.fs, sidecar, now);
    }
    const pdf = read.paper.pdfPath;
    if (!pdf || !isSafeWorkspacePath(pdf) || !(await this.fs.stat(pdf))) return;
    // A file that does not parse may still point at this PDF, so it counts as a user (F97-P2-25).
    const { reads, failures } = await this.scan();
    const others = failures.length > 0 || reads.some((other) => other.paper.pdfPath === pdf);
    if (!others) await moveToTrash(this.fs, pdf, now);
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
      if (!read && !this.writeIds) delete row.id;
      const text = typedCore().writePaperRow(read?.text ?? null, stripUndefined(row));
      const path = read?.path ?? (await this.newPath(String(row.title ?? "")));
      if (await this.writeIf(path, text, read?.text ?? null)) return;
    }
    throw new ConflictError(`Paper ${id} kept changing on disk; not saved.`);
  }

  /** `<papers>/<title slug>.paper.md`, or the first free `-n` name. */
  private async newPath(title: string): Promise<string> {
    const core = typedCore();
    const base = `${core.entityDir("paper", this.projectRoot)}/${core.slugFor(title, "untitled")}`;
    for (let n = 1; n <= NAME_ATTEMPTS; n += 1) {
      const path = n === 1 ? `${base}${PAPER_SUFFIX}` : `${base}-${n}${PAPER_SUFFIX}`;
      if (!(await this.fs.stat(path))) return path;
    }
    throw new ConflictError(`${base}${PAPER_SUFFIX}: no free name; not saved.`);
  }

  /** Writes only if the file is still `expected`; without `writeTextIf` it refuses. */
  private async writeIf(path: string, text: string, expected: string | null): Promise<boolean> {
    if (!this.fs.writeTextIf) {
      throw new Error(`${path}: this workspace has no conditional write; not saved.`);
    }
    if (expected === null) await this.fs.mkdirp(parentOf(path));
    return this.fs.writeTextIf(path, text, expected);
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

  private async readAll(): Promise<PaperFileRead[]> {
    return (await this.scan()).reads;
  }

  /**
   * Every `.paper.md` under `<project>/papers/`, in walk order: read, or why not.
   * A file that cannot be read is a failure too, so it never empties the list.
   */
  private async scan(): Promise<{ reads: PaperFileRead[]; failures: PaperFileFailure[] }> {
    const core = typedCore();
    const dir = core.entityDir("paper", this.projectRoot);
    const reads: PaperFileRead[] = [];
    const failures: PaperFileFailure[] = [];
    if (!(await this.fs.stat(dir))) return { reads, failures };
    for await (const entry of this.fs.walk(dir)) {
      if (!entry.path.endsWith(PAPER_SUFFIX)) continue;
      try {
        const text = await this.fs.readText(entry.path);
        reads.push({ path: entry.path, text, paper: fromRow(core.paperRowFromFile(text), entry.path) });
      } catch (error) {
        failures.push({ path: entry.path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { reads, failures };
  }
}

/** A paper as the row the Rust writer takes: absent fields are left out. */
function toRow(paper: Paper): Record<string, unknown> {
  return stripUndefined({ ...paper });
}

function stripUndefined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

/**
 * The row a file holds as a `Paper`: a file without `weaveforge-id` is the paper
 * at `path`. A missing stamp stays missing, so a write never adds an empty one.
 */
function fromRow(row: Record<string, unknown>, path: string): Paper {
  return { ...row, id: typeof row.id === "string" && row.id ? row.id : path } as unknown as Paper;
}

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function identityOf(paper: Paper | null): PaperIdentity | null {
  return paper ? { id: paper.id, title: paper.title, status: paper.status } : null;
}
