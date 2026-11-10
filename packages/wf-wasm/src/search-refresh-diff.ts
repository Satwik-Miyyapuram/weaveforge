/**
 * Partial-refresh planning (Rust `refresh_diff`). A document is re-added only
 * when it is new, changed, or not provably unchanged. Its print is
 * `JSON.stringify(doc)`, computed here so Rust sees opaque strings.
 */
import { diffRefreshPlan as rawDiffRefreshPlan } from "../pkg/wf_wasm.js";

/**
 * What a partial refresh must touch, and the prints to remember after it.
 * `add` holds the fresh documents to (re)tokenise, and `remove` the held ids
 * that no longer exist.
 */
export function diffRefreshPlan<T extends { id: string }>(
  prints: ReadonlyMap<string, string>,
  held: readonly string[],
  fresh: readonly T[],
): { remove: string[]; add: T[]; prints: Map<string, string> } {
  const raw: {
    remove: string[];
    add: number[];
    prints: { id: string; print: string }[];
  } = rawDiffRefreshPlan(
    [...prints].map(([id, print]) => ({ id, print })),
    held,
    fresh.map((doc) => ({ id: doc.id, print: JSON.stringify(doc) })),
  );
  return {
    remove: raw.remove,
    add: raw.add.map((index) => fresh[index] as T),
    prints: new Map(raw.prints.map((entry) => [entry.id, entry.print])),
  };
}
