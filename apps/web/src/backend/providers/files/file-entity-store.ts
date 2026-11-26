/**
 * One entity kind as workspace files (0.9.7 L3). The file format is the Rust codec
 * (`wf_core::entity_codecs`), shared with the upgrade export, so the repos and the
 * export never drift. This class only finds the files and writes them safely.
 *
 * Laws (proved in test/file-entity-store.test.ts):
 * - A saved row reads back unchanged, at the codec's path.
 * - A save keeps the file's path and every key the kind does not own.
 * - A save never overwrites a file changed on disk since it was read; the row then goes to a conflict copy.
 * - A delete moves the file to `.weaveforge/trash/<day>/`; nothing is unlinked.
 * - One bad file (unreadable, newer format) is skipped and reported, never fatal.
 * - A bad file is kept as it is: a save never takes its path or (when its header shows it) its id.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { ConflictError } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { ConflictCopies } from "@/lib/guarded-save";
import { moveToTrash } from "@/lib/workspace-trash";

/** The kinds the codec knows, by their `weaveforge-type`. */
export type EntityKind = "log_entry" | "experiment" | "report_section" | "reading_list";

/** The project folder the entity folders sit in ("" for the workspace root), asked per call. */
export type ProjectRoot = () => string;

/** How many numbered names a delete (trash) or a conflict copy tries, as for papers and milestones. */
const TRASH_NAME_ATTEMPTS = 1000;

/** One file as read: where it is, its text, and the row it holds. */
export interface FoundEntity<T> {
  path: string;
  text: string;
  row: T;
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
  /** Per id, the file text this store last read or wrote: a save expects the file to still hold it. */
  private readonly loaded = new Map<string, string>();
  /** Per id, the conflict copy this store last wrote: a retry reuses it instead of piling up copies. */
  private readonly copies: ConflictCopies;
  /** Per id, the end of the saves still running: the next save of that id waits for it. */
  private readonly queue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly fs: IWorkspaceFs,
    private readonly root: ProjectRoot,
    private readonly kind: EntityKind,
  ) {
    this.copies = new ConflictCopies(fs);
  }

  /** Every file of this kind under the project's entity folder, sorted by path. */
  async readAll(): Promise<FoundEntity<T>[]> {
    const { found } = await this.scan();
    for (const f of found) this.loaded.set(f.row.id, f.text);
    return found;
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

  /**
   * True when the row in the file now differs from the row in `loadedText` (what this store last read or
   * wrote). Keys the kind does not own (a hand-added property, screening items) are not the row, so their
   * edits merge and never count.
   */
  private rowChanged(loadedText: string | undefined, found: FoundEntity<T>): boolean {
    if (loadedText === undefined || loadedText === found.text) return false;
    try {
      const before = readyCore().entityRowFromFile(this.kind, loadedText);
      return JSON.stringify(before) !== JSON.stringify(found.row);
    } catch {
      return true;
    }
  }

  /** A row as the codec writes and reads it back, so two rows compare field by field. */
  private norm(row: Record<string, unknown>): string {
    const core = readyCore();
    const plain = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
    return JSON.stringify(core.entityRowFromFile(this.kind, core.entityFileFromRow(this.kind, null, plain)));
  }

  /**
   * True when the file's row is no longer the caller's base. A base with an `id` is a whole row: every field
   * counts. One without is the fields the caller's change was based on (an absent field: `key: undefined`).
   */
  private seenChanged(seen: Partial<T>, found: FoundEntity<T>): boolean {
    const now = found.row as unknown as Record<string, unknown>;
    const base = "id" in seen ? (seen as Record<string, unknown>) : { ...now, ...seen };
    try {
      return this.norm(base) !== this.norm(now);
    } catch {
      return true;
    }
  }

  /**
   * Writes the row to its file (a new one at the codec's path). The row in the file must still be the caller's
   * base (`seen`: the row it read, or the fields its change was based on); without it, the one this store last
   * read or wrote (any read refreshes that, so callers that hold a row for a while should pass `seen`). If
   * another writer changed it, that edit is kept, this row goes to a conflict copy (one per base: a retry
   * updates it), and the save fails with ConflictError until the row is read again. Saves of one id run one
   * after another, so two quick saves never race each other.
   */
  save(row: T, seen?: Partial<T>): Promise<void> {
    const prior = this.queue.get(row.id) ?? Promise.resolve();
    const run = prior.then(() => this.saveNow(row, seen));
    const tail = run.catch(() => undefined);
    this.queue.set(row.id, tail);
    void tail.then(() => {
      if (this.queue.get(row.id) === tail) this.queue.delete(row.id);
    });
    return run;
  }

  private async saveNow(row: T, seen?: Partial<T>): Promise<void> {
    const core = readyCore();
    const loadedText = seen === undefined ? this.loaded.get(row.id) : undefined;
    // A copy is reused only by a retry from the same base.
    const basis = seen === undefined ? (loadedText ?? "") : JSON.stringify(seen);
    const { found: rows, held } = await this.scan();
    const found = rows.find((f) => f.row.id === row.id) ?? null;
    const blocked = held.find((h) => h.id === row.id);
    if (blocked && !found) {
      throw new Error(`${blocked.path} could not be read; not saved over or duplicated. Fix or move that file first.`);
    }
    const plain = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
    if (found) {
      const changed = seen === undefined ? this.rowChanged(loadedText, found) : this.seenChanged(seen, found);
      if (changed) {
        const mine = core.entityFileFromRow(this.kind, loadedText ?? found.text, plain);
        const copy = await this.copies.keep(row.id, basis, found.path, mine);
        throw new ConflictError(`${found.path} changed on disk; your version was kept in ${copy}. Reload before saving.`);
      }
      const text = core.entityFileFromRow(this.kind, found.text, plain);
      if (!this.fs.writeTextIf) throw new Error(`${found.path}: this workspace cannot save without overwriting outside edits.`);
      if (!(await this.fs.writeTextIf(found.path, text, found.text))) {
        // Another writer got in between the read and the write: their edit stays, this row goes to a copy.
        const copy = await this.copies.keep(row.id, basis, found.path, text);
        throw new ConflictError(`${found.path} changed on disk; your version was kept in ${copy}. Reload before saving.`);
      }
      this.loaded.set(row.id, text);
      this.copies.forget(row.id);
      return;
    }
    const text = core.entityFileFromRow(this.kind, null, plain);
    const base = core.entityPath(this.kind, plain, this.root());
    // A file at the codec's path that could not be read may hold this row's id: never write a numbered twin.
    if (held.some((h) => h.id === null && h.path === base)) {
      throw new Error(`${base} could not be read; not saved over or duplicated. Fix or move that file first.`);
    }
    const path = await this.freePath(base);
    await writeIfUnchanged(this.fs, path, text, null);
    this.loaded.set(row.id, text);
  }

  /** Moves the row's file to the trash; a missing id is not an error. */
  async delete(id: string): Promise<void> {
    const found = await this.find(id);
    if (found) await moveToTrash(this.fs, found.path, Date.now());
    this.loaded.delete(id);
  }
}
