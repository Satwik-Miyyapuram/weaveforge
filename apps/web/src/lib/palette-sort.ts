/** How the search palette orders its hits. */
export type HitSort = "relevance" | "newest" | "title";

export const HIT_SORTS: readonly { value: HitSort; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "newest", label: "Newest" },
  { value: "title", label: "A–Z" },
];

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Missing or unreadable dates sort last. */
function time(updatedAt: string | undefined): number {
  const parsed = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Ranked rows in the chosen order, as a new array. Ties keep their ranked order
 * (`Array.prototype.sort` is stable), so "Newest" still puts the better match
 * first among same-day edits.
 */
export function sortHits<T extends { title: string; updatedAt?: string }>(rows: readonly T[], order: HitSort): T[] {
  const copy = [...rows];
  // `|| 0`: two undated rows give -Infinity - -Infinity, which is NaN.
  if (order === "newest") return copy.sort((a, b) => time(b.updatedAt) - time(a.updatedAt) || 0);
  if (order === "title") return copy.sort((a, b) => collator.compare(a.title, b.title));
  return copy;
}

interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Space opens the preview, as in Finder. In the search box Space types a space,
 * so there it takes Shift+Space. Other modifiers belong to the system or the
 * input method.
 */
export function isPreviewKey(e: KeyLike, inTextBox: boolean): boolean {
  if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.shiftKey || !inTextBox;
}
