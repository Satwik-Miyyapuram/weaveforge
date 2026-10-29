/**
 * The Rust core (crates/wf-wasm) for TypeScript.
 *
 * wasm-bindgen's raw exports return `any`. Each is re-exported here with the
 * type that crates/wf-bindings generated from the Rust struct into
 * ./bindings.ts. This file declares no types of its own, and every raw export
 * has a wrapper here; test/index.test.ts checks both.
 *
 * The `as` in each wrapper is unchecked, so every wrapper needs a test that
 * checks the runtime value against its type, like the `coreInfo` one.
 *
 * Call `init` (browser, fetches the .wasm) or `initSync` (bytes in hand, e.g.
 * Node) once before any other export.
 */
import init, {
  initSync,
  coreInfo as rawCoreInfo,
  maxIndexTextUtf16 as rawMaxIndexTextUtf16,
  tokenize as rawTokenize,
  indexTerms as rawIndexTerms,
  parseQuery as rawParseQuery,
  maxFusionIds as rawMaxFusionIds,
  fuseRankings as rawFuseRankings,
} from "../pkg/wf_wasm.js";
import type { CoreInfo, ParsedQuery, RankedList, SearchKind, TokenizerOptions } from "./bindings.js";

export type { CoreInfo, ParsedQuery, RankedList, SearchKind, TokenizerOptions };
export { init, initSync };

/** Facts about this core build, such as its version. */
export function coreInfo(): CoreInfo {
  return rawCoreInfo() as CoreInfo;
}

/** Largest text, in UTF-16 units, that `tokenize`, `indexTerms` and `parseQuery` accept (Rust `MAX_INDEX_TEXT_UTF16`). */
export function maxIndexTextUtf16(): number {
  return rawMaxIndexTextUtf16();
}

/** Throws before the text is copied into WASM, which would grow linear memory for good. */
function checkIndexText(text: string): void {
  const max = rawMaxIndexTextUtf16();
  if (text.length > max) {
    throw new RangeError(`text is ${text.length} UTF-16 units; MAX_INDEX_TEXT_UTF16 is ${max}`);
  }
}

/** Search terms of `text`, deduplicated, first occurrence wins. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function tokenize(text: string, options: TokenizerOptions): string[] {
  checkIndexText(text);
  return rawTokenize(text, options) as string[];
}

/** `tokenize` then `processTerm` on each token: what MiniSearch indexes. Not deduplicated. */
export function indexTerms(text: string, options: TokenizerOptions): string[] {
  checkIndexText(text);
  return rawIndexTerms(text, options) as string[];
}

/** The query split into terms, phrases, exclusions and filters. Throws over MAX_INDEX_TEXT_UTF16 units. */
export function parseQuery(query: string): ParsedQuery {
  checkIndexText(query);
  return rawParseQuery(query) as ParsedQuery;
}

/** Most ids one list may pass to `fuseRankings` (Rust `MAX_FUSION_IDS`). */
export function maxFusionIds(): number {
  return rawMaxFusionIds();
}

/** Throws unless `value` is undefined or an integer in 0..=2^32-1. */
function checkU32(name: string, value: number | undefined): void {
  if (value !== undefined && !(Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff)) {
    throw new RangeError(`${name} must be an integer in 0..=4294967295, got ${value}`);
  }
}

/**
 * Reciprocal rank fusion, like `fuseRankings` in @weaveforge/core: `identify`
 * gives the key the lists agree on, and the first list an id appears in
 * supplies its item. Ties break on code point order of the id (the TS used
 * localeCompare). `limit` 0 or undefined means no limit.
 */
export function fuseRankings<T>(
  lists: readonly { items: readonly T[]; weight?: number }[],
  identify: (item: T) => string,
  options: { k?: number; limit?: number } = {},
): T[] {
  checkU32("k", options.k);
  checkU32("limit", options.limit);
  const max = rawMaxFusionIds();
  const representative = new Map<string, T>();
  const ranked: RankedList[] = lists.map((list, index) => {
    if (list.items.length > max) {
      throw new RangeError(`list ${index} has ${list.items.length} ids; MAX_FUSION_IDS is ${max}`);
    }
    const ids = list.items.map((item) => {
      const id = identify(item);
      if (!representative.has(id)) representative.set(id, item);
      return id;
    });
    return { ids, weight: list.weight ?? 1 };
  });
  const limit = options.limit === 0 ? undefined : options.limit;
  const fused = rawFuseRankings(ranked, options.k, limit) as string[];
  return fused.map((id) => representative.get(id) as T);
}
