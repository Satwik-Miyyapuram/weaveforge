/**
 * Which sidebar groups are unfolded (DA-88). The group you are in is always
 * open; the others keep whatever the reader last chose, across restarts.
 * Storage can be missing, blocked or hold junk, and then only the current
 * group is open.
 */
const KEY = "weaveforge.nav.openGroups";

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function withActive(groups: readonly string[], active: string | null): string[] {
  return active && !groups.includes(active) ? [...groups, active] : [...groups];
}

export function toggleGroup(groups: readonly string[], key: string): string[] {
  return groups.includes(key) ? groups.filter((k) => k !== key) : [...groups, key];
}

export function loadOpenGroups(store: Store | undefined, active: string | null): string[] {
  let saved: string[] = [];
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? "[]");
    if (Array.isArray(parsed)) saved = parsed.filter((k): k is string => typeof k === "string");
  } catch {
    // Junk or blocked storage: start from the current group alone.
  }
  return withActive(saved, active);
}

export function saveOpenGroups(store: Store | undefined, groups: readonly string[]): void {
  try {
    store?.setItem(KEY, JSON.stringify(groups));
  } catch {
    // Blocked storage: the choice lasts until the window closes.
  }
}
