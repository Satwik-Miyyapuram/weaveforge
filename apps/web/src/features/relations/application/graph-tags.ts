import { type Paper, type ReadingList, type VaultPage } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/** A note's tags: the hashtags in its title and body, as the graph's edges read them. */
export function noteTags(note: Pick<VaultPage, "title" | "body">): string[] {
  return readyCore().extractHashtags(`${note.title}\n${note.body}`);
}

/** Every tag the graph can filter by, sorted: paper tags, note hashtags and, when shown as concepts, list names. */
export function graphTagNames(
  papers: readonly Pick<Paper, "tags">[],
  notes: readonly Pick<VaultPage, "title" | "body">[],
  lists: readonly Pick<ReadingList, "name">[],
  includeLists: boolean,
): string[] {
  return readyCore().graphTagNames(papers, notes, lists, includeLists);
}

/** The tags seen most often beside `name`: each paper and note counts a tag once. Top `limit`, most first. */
export function relatedConcepts(
  name: string,
  papers: readonly Pick<Paper, "tags">[],
  notes: readonly Pick<VaultPage, "title" | "body">[],
  limit = 12,
): [string, number][] {
  return readyCore().relatedConcepts(name, papers, notes, limit);
}

/** The notes carrying any of `tags` as a whole hashtag (`#ml` is not `#mlops`); all of them when none is chosen. */
export function notesTagged<N extends Pick<VaultPage, "title" | "body">>(
  notes: readonly N[],
  tags: readonly string[],
): N[] {
  return readyCore().notesTagged(notes, tags).map((i) => notes[i]!);
}
