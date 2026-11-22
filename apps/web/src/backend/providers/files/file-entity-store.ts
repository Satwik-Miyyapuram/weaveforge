/**
 * One entity kind as workspace files (0.9.7 L3). The file format is the Rust codec
 * (`wf_core::entity_codecs`), shared with the upgrade export, so the repos and the
 * export never drift. This class only finds the files and writes them safely.
 *
 * Laws (proved in test/file-entity-store.test.ts):
 * - A saved row reads back unchanged, at the codec's path.
 * - A save keeps the file's path and every key the kind does not own.
 * - A save never overwrites a file changed on disk since it was read.
 * - A delete moves the file to `.weaveforge/trash/<day>/`; nothing is unlinked.
 * - One bad file (unreadable, newer format) is skipped and reported, never fatal.
 * - A bad file is kept as it is: a save never takes its path or (when its header shows it) its id.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** The kinds the codec knows, by their `weaveforge-type`. */
export type EntityKind = "log_entry" | "experiment" | "report_section" | "reading_list";

/** The project folder the entity folders sit in ("" for the workspace root), asked per call. */
export type ProjectRoot = () => string;

/** How many numbered trash names a delete tries, as for papers and milestones. */
const TRASH_NAME_ATTEMPTS = 1000;

/** One file as read: where it is, its text, and the row it holds. */
export interface FoundEntity<T> {
  path: string;
  text: string;
  row: T;
}

/** Moves `path` to the first free trash name for today (`-2`, `-3`, … on a clash). */
export async function moveToTrash(fs: IWorkspaceFs, path: string): Promise<void> {
  const core = readyCore();
  const now = Date.now();
  for (let n = 1; n <= TRASH_NAME_ATTEMPTS; n += 1) {
    const target = core.trashPathFor(path, now, n);
    if (await fs.stat(target)) continue;
    await fs.mkdirp(target.slice(0, target.lastIndexOf("/")));
    await fs.rename(path, target);
    return;
  }
  throw new Error(`${path}: no free name in the trash; not deleted.`);
}

/** Writes `text` only if the file still holds `expected` (null: does not exist yet). */
export async function writeIfUnchanged(
  fs: IWorkspaceFs,
  path: string,
  text: string,
  expected: string | null,
): Promise<void> {
  if (!fs.writeTextIf) throw new Error(`${path}: this workspace cannot save without overwriting outside edits.`);
  if (!(await fs.writeTextIf(path, text, expected))) {
    throw new Error(`${path} changed on disk; reload before saving.`);
  }
}

/** A file that could not be read: kept as it is; its id (when its header shows one) is never reused. */
interface HeldFile {
  path: string;
  id: string | null;
}

/** One scan of the entity folder: the readable rows, and the files that could not be read. */
interface Scan<T> {
  found: FoundEntity<T>[];
  held: HeldFile[];
}

export class FileEntityStore<T extends { id: string }> {
  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly root: ProjectRoot,
    private readonly kind: EntityKind,
  ) {}

  /** Every file of this kind under the project's entity folder, sorted by path. */
  async readAll(): Promise<FoundEntity<T>[]> {
    return (await this.scan()).found;
  }

  /** Reads the folder. The held list is returned, never kept on the instance, so a concurrent scan cannot clear it. */
  private async scan(): Promise<Scan<T>> {
    const core = readyCore();
    const dir = core.entityDir(this.kind, this.root());
    const held: HeldFile[] = [];
    if (!(await this.fs.stat(dir))) return { found: [], held };
    const found: FoundEntity<T>[] = [];
    for await (const entry of this.fs.walk(dir)) {
      if (entry.kind !== "file" || !entry.path.endsWith(".md")) continue;
      let row: Record<string, unknown> | null;
      let text = "";
      try {
        text = await this.fs.readText(entry.path);
        row = core.entityRowFromFile(this.kind, text);
      } catch (error) {
        console.warn(`Skipped ${entry.path}: could not read it.`, error);
        held.push({ path: entry.path, id: core.entityIdFromText(text) ?? null });
        continue;
      }
      if (row) found.push({ path: entry.path, text, row: row as T });
    }
    return { found: found.sort((a, b) => a.path.localeCompare(b.path)), held };
  }

  /** A path no file holds yet (readable or not): the codec's, or `…--id-2.<kind>.md`, `-3`… */
  private async freePath(path: string): Promise<string> {
    const at = path.lastIndexOf("--");
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? path : `${path.slice(0, at)}-${n}${path.slice(at)}`;
      if (!(await this.fs.stat(candidate))) return candidate;
      if (n >= TRASH_NAME_ATTEMPTS) throw new Error(`${path}: no free name; not saved.`);
    }
  }

  async all(): Promise<T[]> {
    return (await this.readAll()).map((f) => f.row);
  }

  async find(id: string): Promise<FoundEntity<T> | null> {
    return (await this.readAll()).find((f) => f.row.id === id) ?? null;
  }

  async get(id: string): Promise<T | null> {
    return (await this.find(id))?.row ?? null;
  }

  /** Writes the row to its file (a new one at the codec's path). */
  async save(row: T): Promise<void> {
    const core = readyCore();
    const { found: rows, held } = await this.scan();
    const found = rows.find((f) => f.row.id === row.id) ?? null;
    const blocked = held.find((h) => h.id === row.id);
    if (blocked && !found) {
      throw new Error(`${blocked.path} could not be read; not saved over or duplicated. Fix or move that file first.`);
    }
    const plain = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
    const text = core.entityFileFromRow(this.kind, found?.text ?? null, plain);
    if (found) {
      await writeIfUnchanged(this.fs, found.path, text, found.text);
      return;
    }
    const base = core.entityPath(this.kind, plain, this.root());
    // A file at the codec's path that could not be read may hold this row's id: never write a numbered twin.
    if (held.some((h) => h.id === null && h.path === base)) {
      throw new Error(`${base} could not be read; not saved over or duplicated. Fix or move that file first.`);
    }
    const path = await this.freePath(base);
    await writeIfUnchanged(this.fs, path, text, null);
  }

  /** Moves the row's file to the trash; a missing id is not an error. */
  async delete(id: string): Promise<void> {
    const found = await this.find(id);
    if (found) await moveToTrash(this.fs, found.path);
  }
}
