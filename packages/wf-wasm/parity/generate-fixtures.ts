/**
 * Writes parity/fixtures/<case>/*.json from the TypeScript. The files are
 * frozen goldens: they stay after the TS is deleted, so rerun this only while
 * the TS still exists. Build core first, then from the repo root on Node 24
 * (ICU 78.2, Unicode 17.0, the version the goldens were made on):
 *   node --import tsx packages/wf-wasm/parity/generate-fixtures.ts
 *
 * Lone surrogates are left out: wasm-bindgen turns them into U+FFFD
 * (phase-1-search.md, Unicode).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseSearchQuery, processTerm, tokenize, type TokenizerOptions } from "@weaveforge/core";

/** Every text runs under all 16 option combinations. */
const TOKENIZER_TEXTS = [
  "", "   ", "hello world", "Hello, World! hello",
  "parseHTTPResponse myVariable XMLHttpRequest getID2Name",
  "a1B2C3 ABCDefGHIjk aB ABCdEFg aBCd HTTPServer2Go",
  "my_var snake_Case_X __",
  "café Müller naïve ΣΑΣ İstanbul ǅemal",
  "VAE編碼器 日本語テキスト 한국어 x日y",
  "\u{20000}\u{20001} \u{1d400}\u{1d401}\u{1d402}",
  "see https://arxiv.org/abs/2305.12345 now",
  "foo.com/bar?x=1 sub.example.io",
  "a.comx b.co .com x.COM. HTTPS://Ex.Org",
  "prefix(https://x.y/z) ftp://a.b",
  "http:// http://a hhttp://ab",
  "e.g. i.e. v1.2.3 3.14",
  "x.dev_y x.dev-y a.io_b.com x..com",
  "a.comé a.com\u{1d400}",
  "a.\u{130}o b.\u{131}o c.\u{212a}om",
  "\u{feff}word\u{85}next\u{a0}tail x\u{2028}y.com",
  "émile.com/Été",
  "مُحَمَّد قُرْآن",
  "x:y a:b.org",
  "parseHTTPResponse café https://Ex.org/Été مُحَمَّد VAE編碼器",
  "myVar x.io ÅngströmLab",
  "\u{6e5} x.io/\u{6e5}\u{6e6} a",
  "Café CAFE cafe",
];

/**
 * Queries in the grammar the TS knows. `type:`, `in:` and `modified:` are
 * Rust-only (tested in crates/wf-core/tests/search_query.rs), so they stay out.
 */
const QUERIES = [
  "", "   ", "Graph Neural", '"message passing" graphs',
  'vae -baseline -"work in progress"', "kind:note path:Method tag:#vae latent",
  "KIND:Paper Kind:PDF kind:bogus kind:note:extra", "path: tag: kind: tag:# tag:##x",
  '- " -" -', '"unterminated phrase', '-"unterminated exclusion',
  'a"b -a"b -a"" x"', '"" -"" "  " -"  "', 'path:""x" path:x"" path:"""',
  'tag:"#Q" tag:""y" path:"Multi', "ΣΑΣ İstanbul ÉCOLE",
  "\u{feff}word\u{a0}next\u{85}x\u{2028}y", "--double -- ---", "#hash term#",
  'a "b c" d "e" -f g', "\u{212a}IND:note", "\tkind:log\n\"Deep Dive\"  -Old  ",
  "kind:list kind:section kind:experiment kind:milestone kind:log kind:annotation",
  "Café cafe CAFÉ", "VAE編碼器 x日y", "https://Ex.org/Été -foo.com",
];

/** Mask bits: 1 fold, 2 Arabic, 4 camelCase, 8 URLs (as in the Rust goldens). */
function optionsFor(mask: number): Required<TokenizerOptions> {
  return {
    foldDiacritics: (mask & 1) !== 0,
    foldArabicDiacritics: (mask & 2) !== 0,
    splitCamelCase: (mask & 4) !== 0,
    tokenizeUrls: (mask & 8) !== 0,
  };
}

/** The TS reference for Rust `index_terms`: tokenize, then processTerm each. */
function tsIndexTerms(text: string, options: TokenizerOptions): string[] {
  return tokenize(text, options).map((term) => processTerm(term, options));
}

function write(caseName: string, file: string, input: unknown, expected: unknown): void {
  const dir = new URL(`./fixtures/${caseName}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(file, dir), `${JSON.stringify({ input, expected }, null, 2)}\n`);
}

for (const text of TOKENIZER_TEXTS) {
  // With the u flag, \p{Cs} matches only an unpaired surrogate.
  if (/\p{Cs}/u.test(text)) throw new Error(`lone surrogate in ${JSON.stringify(text)}`);
}
for (const query of QUERIES) {
  if (/(^|\s|-)(type|in|modified):/i.test(query)) throw new Error(`Rust-only filter in ${JSON.stringify(query)}`);
}
write("parse-query", "queries.json", { queries: QUERIES }, QUERIES.map((q) => parseSearchQuery(q)));
for (let mask = 0; mask < 16; mask += 1) {
  const options = optionsFor(mask);
  const input = { texts: TOKENIZER_TEXTS, options };
  const file = `mask-${String(mask).padStart(2, "0")}.json`;
  write("tokenize", file, input, TOKENIZER_TEXTS.map((text) => tokenize(text, options)));
  write("index-terms", file, input, TOKENIZER_TEXTS.map((text) => tsIndexTerms(text, options)));
}
