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
  void write.finally(() => {
    set.delete(write);
    if (set.size === 0 && inFlight.get(noteId) === set) inFlight.delete(noteId);
  });
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
