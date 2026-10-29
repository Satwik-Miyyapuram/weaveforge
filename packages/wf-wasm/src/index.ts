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
} from "../pkg/wf_wasm.js";
import type { CoreInfo, ParsedQuery, SearchKind, TokenizerOptions } from "./bindings.js";

export type { CoreInfo, ParsedQuery, SearchKind, TokenizerOptions };
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
