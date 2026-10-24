import { extractHashtags, type Paper, type ReadingList, type VaultPage } from "@weaveforge/core";

/** A note's tags: the hashtags in its title and body, as the graph's edges read them. */
export function noteTags(note: Pick<VaultPage, "title" | "body">): string[] {
  return extractHashtags(`${note.title}\n${note.body}`);
}

/** Every tag the graph can filter by, sorted: paper tags, note hashtags and, when shown as concepts, list names. */
export function graphTagNames(
  papers: readonly Pick<Paper, "tags">[],
  notes: readonly Pick<VaultPage, "title" | "body">[],
  lists: readonly Pick<ReadingList, "name">[],
  includeLists: boolean,
): string[] {
  const set = new Set<string>();
  for (const p of papers) for (const t of p.tags) set.add(t);
  for (const n of notes) for (const t of noteTags(n)) set.add(t);
  if (includeLists) for (const l of lists) set.add(l.name.toLowerCase());
  return [...set].sort();
}

/** The tags seen most often beside `name`: each paper and note counts a tag once. Top `limit`, most first. */
export function relatedConcepts(
  name: string,
  papers: readonly Pick<Paper, "tags">[],
  notes: readonly Pick<VaultPage, "title" | "body">[],
  limit = 12,
): [string, number][] {
  const counts = new Map<string, number>();
  const count = (tags: Iterable<string>) => {
    for (const t of tags) if (t !== name) counts.set(t, (counts.get(t) ?? 0) + 1);
  };
  for (const p of papers) count(new Set(p.tags));
  for (const n of notes) count(noteTags(n));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
