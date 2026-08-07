/**
 * Recent-query list. Pure so the dedupe and cap rules are testable without a
 * browser; the web app supplies the storage.
 */

export const MAX_SEARCH_HISTORY = 12;

/**
 * Prepend a query, most-recent first.
 *
 * Repeating a query moves it to the front rather than adding a duplicate, and
 * a query that is a prefix of the previous one replaces it — otherwise typing
 * "att", "atten", "attention" would fill the whole list with one search.
 */
export function rememberSearchQuery(
  history: readonly string[],
  query: string,
  max = MAX_SEARCH_HISTORY,
): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [...history];

  const rest = history.filter((entry) => {
    const other = entry.trim();
    if (other.toLowerCase() === trimmed.toLowerCase()) return false;
    // Drop the abandoned prefixes of what the user ended up searching for.
    return !trimmed.toLowerCase().startsWith(other.toLowerCase());
  });

  return [trimmed, ...rest].slice(0, Math.max(1, max));
}

export function forgetSearchQuery(history: readonly string[], query: string): string[] {
  const target = query.trim().toLowerCase();
  return history.filter((entry) => entry.trim().toLowerCase() !== target);
}

/** Drop anything that is not a usable query string. */
export function normalizeSearchHistory(raw: unknown, max = MAX_SEARCH_HISTORY): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}
