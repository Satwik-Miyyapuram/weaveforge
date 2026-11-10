/**
 * Jump-list recents (Rust `recent_targets`), re-exported from index.ts.
 */
import {
  pinRecentTargets as rawPinRecentTargets,
} from "../pkg/wf_wasm.js";

export {
  isRecentTarget,
} from "../pkg/wf_wasm.js";

/**
 * `items` with the recently opened ones moved to the front, in visit order and
 * flagged `recent`. A recent target that no longer matches an item is skipped
 * (Rust `pin_recent_targets` picks the slots; the items keep their identity).
 */
export function pinRecentTargets<T extends { kind: string; id: string }>(
  items: readonly T[],
  recents: readonly { kind: string; id: string }[],
): (T & { recent?: true })[] {
  const slots = rawPinRecentTargets(items, recents) as { index: number; recent: boolean }[];
  return slots.map(({ index, recent }) => {
    const item = items[index] as T;
    return recent ? { ...item, recent: true as const } : item;
  });
}
