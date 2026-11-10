/**
 * Storage for which sidebar groups are unfolded (DA-88). The list logic is in
 * the Rust core; this file only reads and writes localStorage. Storage can be
 * missing, blocked or hold junk, and then only the current group is open.
 */
import { readyCore } from "@/lib/rust-core";

const KEY = "weaveforge.nav.openGroups";

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function loadOpenGroups(store: Store | undefined, active: string | null): string[] {
  let raw: string | null = null;
  try {
    raw = store?.getItem(KEY) ?? null;
  } catch {
    // Blocked storage: the core treats a missing value as nothing saved.
  }
  return readyCore().loadOpenGroups(raw, active);
}

export function saveOpenGroups(store: Store | undefined, groups: readonly string[]): void {
  try {
    store?.setItem(KEY, readyCore().encodeOpenGroups(groups));
  } catch {
    // Blocked storage: the choice lasts until the window closes.
  }
}
