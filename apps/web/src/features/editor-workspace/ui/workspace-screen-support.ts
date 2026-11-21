/** `byKey` without the entries of documents no longer open; `byKey` itself when nothing closed. */
export function keepOpen<T>(byKey: Record<string, T>, open: ReadonlySet<string>): Record<string, T> {
  const keys = Object.keys(byKey);
  if (keys.every((key) => open.has(key))) return byKey;
  return Object.fromEntries(keys.filter((key) => open.has(key)).map((key) => [key, byKey[key]!]));
}

export function store(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/**
 * Whether closing the window now could lose an edit: a save running or failed,
 * or ink or typing still waiting on its debounce.
 */
export function closeWouldLoseWork(state: {
  pending: number;
  dirty: boolean;
  inkPending: number;
  bodyPending: boolean;
}): boolean {
  return state.pending > 0 || state.dirty || state.inkPending > 0 || state.bodyPending;
}

/** How many closed tabs `⌘⇧T` can bring back. */
export const CLOSED_TABS_KEPT = 20;
