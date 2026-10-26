/**
 * How a relation reads from the paper on screen (design D17). A relation is
 * stored one way round, A → B; seen from B, "cites" reads "Cited by".
 */
import type { RelationType } from "@weaveforge/core";
import { enumLabel } from "@/lib/enum-label";

const INCOMING: Record<RelationType, string> = {
  cites: "Cited by",
  extends: "Extended by",
  contradicts: "Contradicted by",
  similar: "Similar",
  builds_on: "Built on by",
  uses_method: "Method used by",
};

/** The phrase for a relation, from the side of the paper it leaves (`outgoing`) or reaches. */
export function relationPhrase(relation: RelationType, outgoing: boolean): string {
  return outgoing ? enumLabel("relation", relation) : INCOMING[relation];
}

/** "‹from› cites ‹to›", or null until both papers are picked. */
export function linkSentence(from: string | undefined, relation: RelationType, to: string | undefined): string | null {
  if (!from || !to) return null;
  return `${from} ${enumLabel("relation", relation).toLowerCase()} ${to}`;
}

/** A copy of `papers` ordered by title, ignoring case. */
export function sortPapersByTitle<T extends { title: string }>(papers: readonly T[]): T[] {
  return [...papers].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}
