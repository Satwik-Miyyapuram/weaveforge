/**
 * Shared rules for a save that must never overwrite an outside edit (files-first stores).
 * A refused save keeps the user's text in a conflict copy beside the file: one copy per
 * base, so retrying the same refused save updates that copy instead of piling up new ones.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { ConflictError } from "@weaveforge/core";
import { conflictCopyPath } from "@/features/migration-097/domain/conflict-path";
import { toAppConflictCopy } from "@/features/migration-097/domain/conflict-copy";

/** How many "(conflict N)" names a copy tries. */
const COPY_NAME_ATTEMPTS = 1000;

/** A conflict copy's text: the `weaveforge-id:` line becomes `conflictOf:`, so no two files share an id. */
export function conflictCopyText(text: string): string {
  return toAppConflictCopy(text);
}


/** Per id, the conflict copy last written, its text and the base it came from. */
export class ConflictCopies {
  private readonly copies = new Map<string, { base: string; path: string; text: string }>();

  constructor(private readonly fs: IWorkspaceFs) {}

  /** After a save of `id` went through, its next conflict starts a new copy. */
  forget(id: string): void {
    this.copies.delete(id);
  }

  /**
   * Keeps `text` (as a copy without the id) in row `id`'s conflict copy and returns its path: the one written
   * last, when it still holds what was written (unchanged text is not written again) and came from the same
   * `base`, else the first free "(conflict N)" name beside `path`. A copy edited or removed since, or from
   * another base, is left alone.
   */
  async keep(id: string, base: string, path: string, text: string): Promise<string> {
    if (!this.fs.writeTextIf) throw new Error(`${path}: this workspace has no conditional write; not saved.`);
    const copy = conflictCopyText(text);
    const last = this.copies.get(id);
    if (last && last.base === base) {
      const held = await this.fs.readText(last.path).catch(() => null);
      if (held === last.text && (copy === held || (await this.fs.writeTextIf(last.path, copy, held)))) {
        this.copies.set(id, { base, path: last.path, text: copy });
        return last.path;
      }
    }
    for (let n = 1; n <= COPY_NAME_ATTEMPTS; n += 1) {
      const target = conflictCopyPath(path, n);
      if (await this.fs.writeTextIf(target, copy, null)) {
        this.copies.set(id, { base, path: target, text: copy });
        return target;
      }
    }
    throw new ConflictError(`${path} changed on disk and no conflict copy name was free; not saved.`);
  }
}

/** One attempt of a guarded change: done with `value` (written, or nothing to write), or null when it lost a race. */
export type GuardedAttempt<T> = { value: T } | null;

/** The refusal for a file this save saw before and that is gone now: trashed or moved, so never recreated. */
export function removedOnDisk(what: string): ConflictError {
  return new ConflictError(`${what} was removed on disk; not saved.`);
}

/**
 * Reads, changes and conditionally writes until one attempt is done, at most `attempts` times (then
 * ConflictError). `read` gives null for a missing file. A file read on an earlier attempt and missing now was
 * trashed or moved mid-change: ConflictError, never written again, as that would recreate it as an orphan.
 */
export async function retryGuarded<R, T>(
  what: string,
  attempts: number,
  read: () => Promise<R | null>,
  attempt: (current: R | null) => Promise<GuardedAttempt<T>>,
): Promise<T> {
  let seen = false;
  for (let n = 0; n < attempts; n += 1) {
    const current = await read();
    if (current === null && seen) throw removedOnDisk(what);
    seen = current !== null;
    const done = await attempt(current);
    if (done) return done.value;
  }
  throw new ConflictError(`${what} kept changing on disk; not saved.`);
}