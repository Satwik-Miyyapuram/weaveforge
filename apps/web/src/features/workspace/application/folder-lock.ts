/**
 * One writer in the workspace folder at a time.
 *
 * The mirror writes the folder from the database, and a git pull, push or
 * conflict choice moves the same tree. Run together, a mirror can write a file
 * a checkout is replacing, or read a manifest a pull has half replaced. Each
 * of them runs through `folderLock`, in the order they asked.
 *
 * A holder must not call another lock-taker and wait for it: the second would
 * queue behind the first and neither would finish. The folder import is kept
 * out for that reason: it ends with a mirror run, which takes the lock itself.
 */

export type FolderLock = {
  /** Run `fn` once every earlier holder has finished, failed or not. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Settles once no holder is running or queued. */
  idle(): Promise<void>;
};

export function createFolderLock(): FolderLock {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(fn) {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    },
    async idle() {
      let seen: Promise<unknown>;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },
  };
}

/** The app's one lock on the workspace folder. */
export const folderLock = createFolderLock();
