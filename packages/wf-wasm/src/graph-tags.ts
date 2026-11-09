/**
 * Graph tag helpers (Rust `graph_tags`), re-exported from index.ts.
 * Keeps the signatures of apps/web/src/features/relations/application/graph-tags.ts.
 * Rust reads only `tags`, `title`, `body` and `name`; extra fields are ignored.
 */
import {
  graphTagNames as rawGraphTagNames,
  relatedConcepts as rawRelatedConcepts,
  notesTagged as rawNotesTagged,
} from "../pkg/wf_wasm.js";
import type { NamedList, TaggedNote, TaggedPaper } from "./bindings.js";

/** The fields the graph tags read from a paper, note and list (generated types). */
export type {
  NamedList as GraphNamedList,
  TaggedNote as GraphTaggedNote,
  TaggedPaper as GraphTaggedPaper,
} from "./bindings.js";

/** Every tag the graph can filter by, sorted in UTF-16 order. */
export function graphTagNames(
  papers: readonly TaggedPaper[],
  notes: readonly TaggedNote[],
  lists: readonly NamedList[],
  includeLists: boolean,
): string[] {
  return rawGraphTagNames(papers, notes, lists, includeLists) as string[];
}

/** The tags seen most often beside `name`, most first; `limit` tags at most. */
export function relatedConcepts(
  name: string,
  papers: readonly TaggedPaper[],
  notes: readonly TaggedNote[],
  limit: number,
): [string, number][] {
  return rawRelatedConcepts(name, papers, notes, limit) as [string, number][];
}

/** Indices of the notes carrying any of `tags`; every index when `tags` is empty. */
export function notesTagged(notes: readonly TaggedNote[], tags: readonly string[]): number[] {
  return rawNotesTagged(notes, tags) as number[];
}
