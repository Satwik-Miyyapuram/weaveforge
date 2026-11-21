/**
 * Fetches the milestone a deep link points at, and returns a cancel for the
 * effect cleanup: a result or error that lands after it is dropped, so a
 * stale fetch never merges an old milestone into the screen (P2-194).
 */
export function loadLinkedMilestone<M>(
  fetch: () => Promise<M | null | undefined>,
  onLoaded: (milestone: M) => void,
  onError: (err: unknown) => void,
): () => void {
  let cancelled = false;
  void fetch().then(
    (m) => {
      if (!cancelled && m) onLoaded(m);
    },
    (err: unknown) => {
      if (!cancelled) onError(err);
    },
  );
  return () => {
    cancelled = true;
  };
}