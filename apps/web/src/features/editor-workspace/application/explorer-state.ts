/**
 * Which explorer rows are expanded, and where that survives a reload.
 *
 * `localStorage`, per device, alongside the theme and paste preferences — an
 * explorer that reopens fully collapsed makes the user re-navigate to the note
 * they were editing every time the app restarts, and "which folders I keep open
 * on this machine" is not something to sync to other devices.
 *
 * The storage handle is a parameter rather than the global so the rules can be
 * tested without a DOM, and so a private-mode failure is one caller's problem.
 */

export const EXPLORER_STORAGE_KEY = "weaveforge.explorer.expanded";

/** The roots start open: an explorer with nothing visible looks broken. */
export const DEFAULT_EXPANDED: readonly string[] = ["notes", "papers", "report"];

export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function readExpanded(store: KeyValueStore | undefined): Set<string> {
  if (!store) return new Set(DEFAULT_EXPANDED);
  try {
    const raw = store.getItem(EXPLORER_STORAGE_KEY);
    if (raw === null) return new Set(DEFAULT_EXPANDED);
    const parsed: unknown = JSON.parse(raw);
    // An empty array is a real answer — the user collapsed everything — so it
    // is honoured, unlike a missing or malformed record.
    if (!Array.isArray(parsed)) return new Set(DEFAULT_EXPANDED);
    return new Set(parsed.filter((key): key is string => typeof key === "string"));
  } catch {
    return new Set(DEFAULT_EXPANDED);
  }
}

export function writeExpanded(store: KeyValueStore | undefined, expanded: Iterable<string>): void {
  try {
    store?.setItem(EXPLORER_STORAGE_KEY, JSON.stringify([...expanded]));
  } catch {
    // Storage disabled. The tree still expands for this session.
  }
}

/** Expanded rows, with `key` flipped. Returns a new set; never mutates. */
export function toggleExpanded(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(expanded);
  if (!next.delete(key)) next.add(key);
  return next;
}
