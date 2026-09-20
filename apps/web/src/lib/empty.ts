/** Stable empty collections for hook dependency arrays (react-hooks-cleanup-plan Class A). */
const EMPTY_ARR: readonly never[] = [];
const EMPTY_MAP = new Map() as unknown as ReadonlyMap<string, never>;
const EMPTY_SET = new Set() as unknown as ReadonlySet<never>;

export function emptyArray<T>(): T[] {
  return EMPTY_ARR as unknown as T[];
}

export function emptyMap<K, V>(): Map<K, V> {
  return EMPTY_MAP as unknown as Map<K, V>;
}

export function emptySet<T>(): Set<T> {
  return EMPTY_SET as unknown as Set<T>;
}
