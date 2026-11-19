/**
 * Screening decisions kept in the reading-list files themselves (files-first, L6).
 * The file format and every rule live in Rust (`wf_core::reading_lists::list_file`);
 * this class only finds the right file and writes it back with the hash it read,
 * so a file changed on disk in between is never overwritten.
 *
 * A list file names each paper by a `[[link]]` to its note, never by id. The app
 * still asks by item id, so the port turns an id into its note link and a link back
 * into the item it resolves to, the way any other link in the vault resolves.
 */
import { NotFoundError, type IScreeningRepository, type ScreeningDecision } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** A list file as read: its workspace path, text and content hash. */
export interface ListFile {
  readonly path: string;
  readonly text: string;
  readonly hash: string;
}

/** The file access the repository needs; the shell's checked file commands provide it. */
export interface ListFilesPort {
  /** Every reading-list file in the workspace. */
  listFiles(): Promise<readonly ListFile[]>;
  /** The `[[link]]` to item `itemId`'s paper note, or null when it has none. */
  linkForItem(itemId: string): Promise<string | null>;
  /** The item whose paper note `link` resolves to, or null when none does. */
  itemForLink(link: string): Promise<string | null>;
  /** The list file that holds the paper `link` points at, or null when no list does. */
  fileForLink(link: string): Promise<ListFile | null>;
  /** Writes `text` to `path`; fails when the file's hash is no longer `expectedHash`. */
  write(path: string, text: string, expectedHash: string): Promise<void>;
}

export class FileScreeningRepository implements IScreeningRepository {
  constructor(private readonly files: ListFilesPort) {}

  async listForItems(itemIds: readonly string[]): Promise<ScreeningDecision[]> {
    if (itemIds.length === 0) return [];
    const wanted = new Set(itemIds);
    const items = new Map<string, string | null>();
    const all: ScreeningDecision[] = [];
    for (const file of await this.files.listFiles()) {
      for (const d of this.readable(file)) {
        if (!items.has(d.itemId)) items.set(d.itemId, await this.files.itemForLink(d.itemId));
        const itemId = items.get(d.itemId);
        if (itemId && wanted.has(itemId)) all.push({ ...d, itemId });
      }
    }
    return readyCore().effectiveScreening(all) as ScreeningDecision[];
  }

  /** The file's decisions, or none when it cannot be read, so one damaged list
   *  never hides the others. A damaged file is never written, and it is reported
   *  to the console so the damage is not silent. */
  private readable(file: ListFile): ScreeningDecision[] {
    try {
      return readyCore().screeningInListFile(file.text) as ScreeningDecision[];
    } catch (error) {
      console.warn(`Reading-list file ${file.path} could not be read for screening; skipped.`, error);
      return [];
    }
  }

  async record(decision: ScreeningDecision): Promise<void> {
    const link = await this.files.linkForItem(decision.itemId);
    if (!link) throw new NotFoundError(`Item ${decision.itemId} has no paper note to link to`);
    const file = await this.files.fileForLink(link);
    if (!file) throw new NotFoundError(`No reading list holds item ${decision.itemId}`);
    const text = readyCore().recordInListFile(file.text, { ...decision, itemId: link });
    await this.files.write(file.path, text, file.hash);
  }

  async remove(id: string): Promise<void> {
    const core = readyCore();
    for (const file of await this.files.listFiles()) {
      if (!this.readable(file).some((d) => d.id === id)) continue;
      await this.files.write(file.path, core.removeFromListFile(file.text, id), file.hash);
    }
  }
}
