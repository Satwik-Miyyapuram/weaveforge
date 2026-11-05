/**
 * Open the local database, patiently: a lock held by a process that is still
 * exiting clears in about a second, and giving up early costs a restore. See
 * `OPEN_ATTEMPTS` in `main-local-db.ts` for the schedule.
 *
 * It does not log. Giving up throws the last failure, and the recovery that
 * catches it is what says, once, what failed and what is being done about it.
 */
export interface OpenRetryOptions {
  attempts: number;
  backoffMs: number;
  maxBackoffMs: number;
  /** A failure waiting cannot fix: thrown at once. */
  giveUpOn?: (cause: unknown) => boolean;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export async function openWithRetry<T>(open: () => Promise<T>, options: OpenRetryOptions): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: unknown;
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await open();
    } catch (cause) {
      if (options.giveUpOn?.(cause)) throw cause;
      last = cause;
      if (attempt < options.attempts - 1) {
        await sleep(Math.min(options.backoffMs * 2 ** attempt, options.maxBackoffMs));
      }
    }
  }
  throw last;
}
