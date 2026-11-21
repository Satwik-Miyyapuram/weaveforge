/** `byKey` without the entries of documents no longer open; `byKey` itself when nothing closed. */
export function keepOpen<T>(byKey: Record<string, T>, open: ReadonlySet<string>): Record<string, T> {
  const keys = Object.keys(byKey);
  if (keys.every((key) => open.has(key))) return byKey;
  return Object.fromEntries(keys.filter((key) => open.has(key)).map((key) => [key, byKey[key]!]));
}

export function store(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** How many closed tabs `⌘⇧T` can bring back. */
export const CLOSED_TABS_KEPT = 20;
