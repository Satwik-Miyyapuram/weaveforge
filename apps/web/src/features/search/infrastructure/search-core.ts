import type { TokenizerOptions } from "@weaveforge/wasm";
import type { RustCore } from "@/lib/rust-core";

/** The Rust search functions the index uses. Tests pass the real core. */
export type SearchCore = Pick<RustCore, "indexTerms" | "parseQuery" | "buildExcerpt" | "maxIndexTextUtf16">;

/** The TS tokenizer's defaults. Index and query share them, or terms never match. */
export const TOKENIZER_OPTIONS: TokenizerOptions = {
  foldDiacritics: true,
  foldArabicDiacritics: false,
  splitCamelCase: true,
  tokenizeUrls: true,
};

/** Index terms of `text`, cut to the longest text Rust accepts rather than throwing. */
export function indexTermsOf(core: SearchCore, text: string): string[] {
  return core.indexTerms(capped(core, text), TOKENIZER_OPTIONS);
}

/** The longest prefix of `text` Rust accepts; longer text throws a RangeError there. */
function capped(core: SearchCore, text: string): string {
  const max = core.maxIndexTextUtf16();
  return text.length > max ? text.slice(0, max) : text;
}

/** A 200-character excerpt of `body` around `terms`, cut like `indexTermsOf`. */
export function excerptOf(core: SearchCore, body: string, terms: readonly string[]): ReturnType<SearchCore["buildExcerpt"]> {
  return core.buildExcerpt(capped(core, body), [...terms], { maxChars: 200 });
}
