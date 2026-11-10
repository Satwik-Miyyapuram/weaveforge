import { type VaultPage, type VaultPageSummary } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** What the notes screen derives from its list. The rules live in wf-core `vault::page`. */
type Note = VaultPageSummary | VaultPage;

/** The other notes whose body links to the selected note's title (wf-core `note_backlinks`). */
export function noteBacklinks(
  notes: readonly Note[],
  selectedId: string | null,
): { id: string; title: string }[] {
  return readyCore().noteBacklinks(notes, selectedId ?? undefined) as { id: string; title: string }[];
}

/**
 * The notes in any chosen list and carrying any chosen tag. An empty filter keeps everything.
 * Cheap set membership, run before the ranked search (wf-core `scope_notes`, which returns the
 * positions kept; they are mapped back to the caller's objects here).
 */
export function scopeNotes<N extends Note>(
  notes: readonly N[],
  filter: {
    listFilter: readonly string[];
    tagFilter: readonly string[];
    membership: ReadonlyMap<string, ReadonlySet<string>>;
  },
): N[] {
  const membership = Object.fromEntries(
    [...filter.membership].map(([listId, ids]) => [listId, [...ids]]),
  );
  const kept = readyCore().scopeNoteIndices(
    notes,
    [...filter.listFilter],
    [...filter.tagFilter],
    membership,
  ) as number[];
  return kept
    .map((index) => notes[index])
    .filter((note): note is N => note !== undefined);
}
