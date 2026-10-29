// Prints the golden tables in tests/search_tokenize.rs from the TypeScript.
// Run from the repo root on Node 24 (ICU 78.2, Unicode 17.0), then rustfmt:
//   node crates/wf-core/tests/goldens/search-tokenize.mjs
import { processTerm, tokenize, urlParts } from "../../../../packages/core/src/search/search-tokenizer.ts";

const INPUTS = [
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
];

const RICH = ["parseHTTPResponse café https://Ex.org/Été مُحَمَّد VAE編碼器", "myVar x.io ÅngströmLab", "\u{6e5} x.io/\u{6e5}\u{6e6} a"];

const BS = String.fromCharCode(92);
const rs = (s) => {
  let o = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    o += c < 0x20 || c > 0x7e || ch === '"' || ch === BS ? `${BS}u{${c.toString(16)}}` : ch;
  }
  return `"${o}"`;
};
const arr = (xs) => `&[${xs.map(rs).join(", ")}]`;
const optionsFor = (mask) => ({
  foldDiacritics: (mask & 1) !== 0,
  foldArabicDiacritics: (mask & 2) !== 0,
  splitCamelCase: (mask & 4) !== 0,
  tokenizeUrls: (mask & 8) !== 0,
});
const indexTerms = (text, options) => tokenize(text, options).map((t) => processTerm(t, options));

console.log("/// (input, url_parts, tokenize with TS defaults, index_terms with TS defaults)");
console.log("const DEFAULT_CASES: &[(&str, &[&str], &[&str], &[&str])] = &[");
for (const w of INPUTS) console.log(`(${rs(w)}, ${arr(urlParts(w))}, ${arr(tokenize(w))}, ${arr(indexTerms(w, {}))}),`);
console.log("];");
console.log("");
console.log("/// (input, option mask, tokenize, index_terms). Mask bits: 1 fold, 2 Arabic, 4 camelCase, 8 URLs.");
console.log("const OPTION_CASES: &[OptionCase] = &[");
for (const w of RICH) {
  for (let m = 0; m < 16; m += 1) {
    const o = optionsFor(m);
    console.log(`(${rs(w)}, ${m}, ${arr(tokenize(w, o))}, ${arr(indexTerms(w, o))}),`);
  }
}
console.log("];");
