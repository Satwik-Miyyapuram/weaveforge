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
  const max = core.maxIndexTextUtf16();
  return core.indexTerms(text.length > max ? text.slice(0, max) : text, TOKENIZER_OPTIONS);
}
