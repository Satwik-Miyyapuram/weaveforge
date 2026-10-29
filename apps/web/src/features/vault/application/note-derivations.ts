import {
  bodyLinksTo,
  extractHashtags,
  normalizeTitleKey,
  type VaultPage,
  type VaultPageSummary,
} from "@weaveforge/core";
import { noteBodyText } from "@/lib/page-text";

/** What the notes screen derives from its list, kept out of the component. */
type Note = VaultPageSummary | VaultPage;

/** The other notes whose body links to the selected note's title. */
export function noteBacklinks(
  notes: readonly Note[],
  selectedId: string | null,
): { id: string; title: string }[] {
  if (!selectedId) return [];
  const target = notes.find((p) => p.id === selectedId);
  if (!target) return [];
  const key = normalizeTitleKey(target.title);
  return notes
    .filter((p) => p.id !== target.id && bodyLinksTo(noteBodyText(p), key))
    .map((p) => ({ id: p.id, title: p.title }));
}

/** Every hashtag used across the notes, distinct and sorted. */
export function noteTags(notes: readonly Note[]): string[] {
  const set = new Set<string>();
  for (const p of notes) for (const t of extractHashtags(noteBodyText(p))) set.add(t);
  return [...set].sort();
}

/**
 * The notes in any chosen list and carrying any chosen tag. An empty filter
 * keeps everything. Cheap set membership, run before the ranked search.
 */
export function scopeNotes<N extends Note>(
  notes: readonly N[],
  filter: {
    listFilter: readonly string[];
    tagFilter: readonly string[];
    membership: ReadonlyMap<string, ReadonlySet<string>>;
  },
): N[] {
  const { listFilter, tagFilter, membership } = filter;
  const inAnyList = (id: string) => listFilter.some((lid) => membership.get(lid)?.has(id) ?? false);
  const hasAnyTag = (p: N) => tagFilter.some((t) => extractHashtags(noteBodyText(p)).includes(t));
  return notes.filter(
    (p) => (listFilter.length === 0 || inAnyList(p.id)) && (tagFilter.length === 0 || hasAnyTag(p)),
  );
}
