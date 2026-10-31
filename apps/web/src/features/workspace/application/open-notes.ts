/**
 * Notes open in an editor right now, by id.
 *
 * Editors save as they type, so a note open in one can hold text not yet saved; an outside edit to it waits for
 * review instead of landing under the cursor. Counted, since one note can be open in two places.
 */
const open = new Map<string, number>();

/** Mark these notes open until the returned function is called. Calling it twice releases once. */
export function holdOpenNotes(ids: readonly string[]): () => void {
  const unique = [...new Set(ids)];
  for (const id of unique) open.set(id, (open.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const id of unique) {
      const count = (open.get(id) ?? 0) - 1;
      if (count > 0) open.set(id, count);
      else open.delete(id);
    }
  };
}

/** Whether some editor has this note open. */
export function isNoteOpen(id: string): boolean {
  return open.has(id);
}
