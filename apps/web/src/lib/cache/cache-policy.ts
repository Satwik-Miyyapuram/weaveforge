/**
 * How old a cached screen payload may be, for each of the two questions.
 *
 * There were two numbers in two files that never named each other, which is how
 * a caching policy becomes something nobody can change with confidence. They are
 * genuinely different questions, and the point of writing them here is to say
 * so once:
 *
 *   * **Skip the network?** A response-time decision. Within this window the
 *     cached payload is shown without revalidating; past it the payload is still
 *     shown, and refreshed behind the reader.
 *   * **Show it at all?** A trust decision, on a much longer scale. Past this
 *     the payload is treated as absent and a spinner is the honest answer — a
 *     week-old screen presented as current is worse than a moment's wait.
 *
 * Both are measured against when the payload was *fetched*, not when this
 * process learned about it: a copy read back from IndexedDB after a reload is as
 * old as it is, and stamping it with the read time is what makes a stale screen
 * look freshly loaded and suppresses the revalidation that would have fixed it.
 */

/** Older than this: show it, and refetch in the background. */
export const SCREEN_REVALIDATE_AFTER_MS = 120_000;

/**
 * Older than this: do not show it. A week — long enough that reopening the app
 * after a weekend paints instantly, short enough that nothing appears from a
 * project somebody has half-forgotten.
 */
export const SCREEN_SHOW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
