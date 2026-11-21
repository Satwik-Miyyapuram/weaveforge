// --- ink-pending-writes ---
/**
 * The saves still on their way to the chunk store, by note.
 *
 * The ink host flushes its last save as it unmounts, and the write lands a
 * little later — after the worker has encoded the page. Whatever mounts in
 * its place for the same note (the reader, or the host again) must not read
 * the store before that write, or it shows the note as it was a stroke ago.
 * Module state rather than context: the two never share a tree.
 */
const inFlight = new Map<string, Set<Promise<unknown>>>();

/** Register a write so readers of `noteId` can wait for it. */
export function trackInkWrite(noteId: string, write: Promise<unknown>): void {
  let set = inFlight.get(noteId);
  if (!set) {
    set = new Set();
    inFlight.set(noteId, set);
  }
  set.add(write);
  // Both ways: a rejected write is the caller's to report, not an unhandled one here.
  const done = () => {
    set.delete(write);
    if (set.size === 0 && inFlight.get(noteId) === set) inFlight.delete(noteId);
  };
  write.then(done, done);
}

/** Resolves once every write registered for `noteId` so far has settled. */
export async function awaitInkWrites(noteId: string): Promise<void> {
  // Loop: a write can be registered while another is awaited.
  for (;;) {
    const set = inFlight.get(noteId);
    if (!set || set.size === 0) return;
    await Promise.allSettled([...set]);
  }
}

// --- load-in-order ---
/**
 * Load every item at once and keep the ones that arrived, in input order.
 *
 * An export's figures are independent fetches; awaiting them one by one made
 * a page with many figures as slow as their sum. Order still matters — later
 * figures draw over earlier ones — so results land by index, and an item
 * whose load fails (a missing attachment) is simply left out.
 */
export async function loadInOrder<T, R>(
  items: readonly T[],
  load: (item: T) => Promise<R>,
): Promise<R[]> {
  const settled = await Promise.allSettled(
    items.map(async (item) => load(item)),
  );
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}

// --- ink-save-status ---
/**
 * Whether ink is on its way to the store, or failed to get there.
 *
 * The status bar reads the note's save state from the workspace, which never
 * sees ink strokes. A stroke arms a debounce, the debounce runs a write, and
 * until that write settles the note is unsaved. A failed write stays failed
 * until a later write succeeds. Module state, read with
 * useSyncExternalStore, so the ink host and the workspace need no shared tree.
 */
export interface InkSaveStatus {
  readonly pending: number;
  readonly failed: boolean;
}

let inkSaveSnapshot: InkSaveStatus = { pending: 0, failed: false };
const inkSaveListeners = new Set<() => void>();

function publishInkSaveStatus(next: InkSaveStatus): void {
  inkSaveSnapshot = next;
  for (const listener of [...inkSaveListeners]) listener();
}

/** Start one save cycle. The returned settle runs once; a second call is ignored. */
export function beginInkSave(): (ok: boolean) => void {
  const current = inkSaveSnapshot;
  publishInkSaveStatus({ pending: current.pending + 1, failed: current.failed });
  let settled = false;
  return (ok: boolean) => {
    if (settled) return;
    settled = true;
    const now = inkSaveSnapshot;
    publishInkSaveStatus({ pending: Math.max(0, now.pending - 1), failed: !ok });
  };
}

/** The current status; the same object until it changes. */
export function getInkSaveStatus(): InkSaveStatus {
  return inkSaveSnapshot;
}

/** Called on every status change. Returns the unsubscribe. */
export function subscribeInkSaveStatus(listener: () => void): () => void {
  inkSaveListeners.add(listener);
  return () => {
    inkSaveListeners.delete(listener);
  };
}
