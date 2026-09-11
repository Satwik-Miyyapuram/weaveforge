/**
 * Quitting, with a limit on how long it may take.
 *
 * The local database is a WASM Postgres, and closing it can in principle take
 * as long as it likes: a statement still running, a file lock, a data directory
 * on a drive that has gone away. `will-quit` is the one place that close is
 * awaited, and a `will-quit` handler that neither returns nor calls `app.exit`
 * leaves the process alive with no window — invisible, still holding the
 * single-instance lock, so every later launch raises a window that is not there
 * and then quits. A reader whose only recourse is Task Manager has not been
 * given a bug report; they have been given a mystery.
 *
 * So the ordered shutdown stays — closing the database is what makes the next
 * launch start from a clean state — and it is given a bounded amount of time to
 * finish. Past that the process leaves anyway: an unclosed WASM database is a
 * recoverable problem, and an app that cannot be closed is not.
 *
 * The clock is injected for the same reason the schedule is in `auto-update.ts`
 * — so the timeout can be tested without waiting for it.
 */

export const QUIT_TIMEOUT_MS = 3_000;

/**
 * The timers this needs, as a parameter rather than globals.
 *
 * Node's `setTimeout` returns a different handle type on every platform, and
 * naming that type here would be a name that has to be right on three of them.
 */
export interface QuitTimers {
  after(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

const nodeTimers: QuitTimers = {
  after: (fn, ms) => setTimeout(fn, ms),
  cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface QuitOptions {
  /** Whatever has to happen before the process may leave. May hang. */
  cleanup: () => Promise<unknown>;
  /** How the process leaves once it may. */
  exit: () => void;
  /** How long cleanup is given. Injected in tests, not in the app. */
  timeoutMs?: number;
  timers?: QuitTimers;
}

/**
 * Run the shutdown, and leave whether or not it finishes.
 *
 * `exit` is called exactly once, which is the property that matters: two calls
 * at once would be a quit racing a force-quit, and the timer is cancelled on the
 * normal path so the fallback cannot arrive after the process has already
 * decided to go.
 *
 * The timer is armed before the cleanup starts, not after, because "after"
 * would never be reached in the case this exists for.
 */
export function runBoundedQuit(options: QuitOptions): void {
  const { cleanup, exit, timeoutMs = QUIT_TIMEOUT_MS, timers = nodeTimers } = options;

  let leaving = false;
  const leave = () => {
    if (leaving) return;
    leaving = true;
    timers.cancel(fallback);
    exit();
  };

  // Armed first. The force-exit deliberately does not prevent the real cleanup
  // from finishing first: whichever of the two arrives first is the one that
  // leaves, and the other is cancelled.
  const fallback = timers.after(leave, timeoutMs);

  // A cleanup that rejects is a cleanup that is over. The reader is quitting,
  // so there is nothing to report it to and nothing left to do about it.
  cleanup().then(leave, leave);
}
