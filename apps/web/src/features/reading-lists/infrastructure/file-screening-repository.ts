/**
 * Screening decisions kept in the reading-list files themselves (files-first, L6).
 * The file format and every rule live in Rust (`wf_core::reading_lists::list_file`);
 * this class only finds the right file and writes it back with the hash it read,
 * so a file changed on disk in between is never overwritten.
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
  /** The list file that holds item `itemId`, or null when no list does. */
  fileForItem(itemId: string): Promise<ListFile | null>;
  /** Writes `text` to `path`; fails when the file's hash is no longer `expectedHash`. */
  write(path: string, text: string, expectedHash: string): Promise<void>;
}

export class FileScreeningRepository implements IScreeningRepository {
  constructor(private readonly files: ListFilesPort) {}

  async listForItems(itemIds: readonly string[]): Promise<ScreeningDecision[]> {
    if (itemIds.length === 0) return [];
    const wanted = new Set(itemIds);
    const core = readyCore();
    const all: ScreeningDecision[] = [];
    for (const file of await this.files.listFiles()) {
      all.push(...this.readable(file).filter((d) => wanted.has(d.itemId)));
    }
    return core.effectiveScreening(all) as ScreeningDecision[];
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
    const file = await this.files.fileForItem(decision.itemId);
    if (!file) throw new NotFoundError(`No reading list holds item ${decision.itemId}`);
    const text = readyCore().recordInListFile(file.text, decision);
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
