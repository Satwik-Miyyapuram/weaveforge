/**
 * Pure helpers for the IndexedDB PDF cache — unit-tested without a browser DB.
 */

export function pickKeysToEvict(
  entries: readonly { key: string; updatedAt: number }[],
  maxEntries: number,
): string[] {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("maxEntries must be a positive integer");
  }
  if (entries.length <= maxEntries) return [];
  const sorted = [...entries].sort((a, b) => a.updatedAt - b.updatedAt);
  return sorted.slice(0, entries.length - maxEntries).map((e) => e.key);
}
