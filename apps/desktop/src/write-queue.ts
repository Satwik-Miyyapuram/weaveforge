import { randomBytes } from "node:crypto";

/**
 * One write at a time, for a file that is rewritten whole.
 *
 * The shell keeps two of these files — its preferences and the sealed secrets —
 * and both are edited the same way: read the file, change one key, write the
 * whole thing back. Two of those overlapping lose an update. The settings panel
 * saving a server address while the File menu saves the chosen folder both read
 * the same file, each adds its own key, and the second to land writes back a
 * copy that never saw the first one's key. The window is small because a disk is
 * fast, which is exactly what makes this the kind of bug that surfaces once a
 * month on somebody else's machine.
 *
 * Serialising cannot be left to the file: both writes are in this process, and
 * the loser is decided by which *read* was stale, not by which write arrived
 * first. So the whole cycle — read, change, write — is what queues.
 *
 * A failed write does not poison the queue. What is queued is a promise chain,
 * and an error left at the end of it would fail every write after it; the item
 * resolves with its own result instead, and the chain carries on.
 */
export class WriteQueue {
  /** The tail of the chain. `undefined` until something is queued. */
  private tail: Promise<unknown> | undefined;

  /** Run one whole read-modify-write once the one before it has finished. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = (this.tail ?? Promise.resolve()).then(task);
    // Kept as a settled promise so one failure is not the next call's problem.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * A name no other write in this process is using.
 *
 * Every writer used to be distinguished by pid alone, which is true across
 * processes and false inside one: two writes in the same millisecond picked the
 * same `.tmp` name, so the loser's rename published the winner's bytes — or the
 * winner's rename published the loser's. A counter is what is actually needed
 * (two writes here are never equal), and the random suffix is what makes a
 * leftover file from a killed process, or from the *same* pid after a wrap,
 * something the next run cannot collide with.
 */
let tempCounter = 0;

export function temporaryName(suffix = ".tmp"): string {
  tempCounter += 1;
  return `${process.pid}.${tempCounter}.${randomBytes(4).toString("hex")}${suffix}`;
}
