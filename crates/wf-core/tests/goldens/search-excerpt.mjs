// Prints the golden table in tests/search_excerpt.rs from the TypeScript.
// Build core first (npm run build -w @weaveforge/core), then from the repo
// root on Node 24 (ICU 78.2, Unicode 17.0), then rustfmt:
//   node crates/wf-core/tests/goldens/search-excerpt.mjs
// The expected text goes through toWellFormed(): a window edge can split a
// surrogate pair, and Rust compares the lossy decoding (same UTF-16 length).
// LONE_UNITS then pins each lone half exactly: (case index, unit index, unit).
import { buildExcerpt } from "../../../../packages/core/dist/index.js";

const filler = (n) => "lorem ipsum ".repeat(n);
const INPUTS = [
  ["", ["x"], undefined, undefined],
  [" \n\t ", ["x"], undefined, undefined],
  ["Graph neural networks", ["graph"], undefined, undefined],
  ["Graph neural networks", ["GRAPH", "Networks"], undefined, undefined],
  ["no hit here", ["absent"], undefined, undefined],
  ["a short body", ["x"], 10, undefined],
  [filler(30), ["zzz"], undefined, undefined],
  [filler(30), ["zzz"], 60, undefined],
  [`${filler(20)}target ${filler(20)}`, ["target"], 60, undefined],
  [`alpha ${filler(15)}beta gamma delta ${filler(15)}`, ["alpha", "beta", "gamma", "delta"], 60, undefined],
  [`${filler(25)}end match`, ["match"], 60, undefined],
  ["abc abc", ["ab", "bc"], undefined, undefined],
  ["aaaa", ["aa"], undefined, undefined],
  ["xx yy", ["xx", "x y"], undefined, undefined],
  ["one two", ["o", " t ", "  "], undefined, undefined],
  ["line one\n\nline two\r\n  three", ["two"], undefined, undefined],
  ["line one\n\nline two\r\n  three", ["two"], undefined, false],
  ["  padded\u{a0}\u{feff}text\u{2028}here\u{85}x  ", ["text"], undefined, undefined],
  ["\u{130}stanbul and ISTANBUL", ["istanbul"], undefined, undefined],
  ["\u{130}stanbul", ["i\u{307}s"], undefined, undefined],
  ["\u{3a3}\u{391}\u{3a3} \u{3c3}\u{3b1}\u{3c3}", ["\u{3c3}\u{3b1}\u{3a3}"], undefined, undefined],
  ["\u{3a3}\u{391}\u{3a3} \u{3c3}\u{3b1}\u{3c2}", ["\u{3c3}\u{3b1}\u{3c2}"], undefined, undefined],
  ["\u{212a}elvin kelvin", ["kelvin"], undefined, undefined],
  ["Stra\u{df}e STRASSE", ["stra\u{df}e"], undefined, undefined],
  ["\u{c9}cole \u{e9}cole", ["\u{e9}cole"], undefined, undefined],
  [`${"\u{1f600}".repeat(30)}hit${"\u{1f600}".repeat(30)}`, ["hit"], 40, undefined],
  [`${"\u{1f600}".repeat(30)}`, ["zz"], 41, undefined],
  ["\u{1f600}x\u{1f600}x", ["\u{1f600}x"], undefined, undefined],
  [`${filler(4)}straddle${filler(6)}`, ["lorem ipsum lorem ipsum lorem ipsum lorem"], 40, undefined],
  ["exact forty characters of text right here", ["here"], 40, undefined],
  [filler(3), ["lorem"], 0, undefined],
];

const BS = String.fromCharCode(92);
const rs = (s) => {
  let o = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    o += c < 0x20 || c > 0x7e || ch === '"' || ch === BS ? `${BS}u{${c.toString(16)}}` : ch;
  }
  return `"${o}"`;
};
const opt = (v, f) => (v === undefined ? "None" : `Some(${f(v)})`);

console.log("/// (body, terms, max_chars, single_line, text, highlights)");
console.log("const CASES: &[ExcerptCase] = &[");
const lone = [];
for (const [index, [body, terms, maxChars, singleLine]] of INPUTS.entries()) {
  const options = {};
  if (maxChars !== undefined) options.maxChars = maxChars;
  if (singleLine !== undefined) options.singleLine = singleLine;
  const e = buildExcerpt(body, terms, options);
  // for...of yields a lone half as a one-unit string.
  let at = 0;
  for (const ch of e.text) {
    if (!ch.isWellFormed()) lone.push(`(${index}, ${at}, 0x${ch.charCodeAt(0).toString(16)})`);
    at += ch.length;
  }
  const hl = e.highlights.map((r) => `(${r.start}, ${r.end})`).join(", ");
  console.log(
    `(${rs(body)}, &[${terms.map(rs).join(", ")}], ${opt(maxChars, String)}, ` +
      `${opt(singleLine, String)}, ${rs(e.text.toWellFormed())}, &[${hl}]),`,
  );
}
console.log("];");
console.log("/// (case index, unit index, unit): lone surrogate halves in the TS text.");
console.log(`const LONE_UNITS: &[(usize, usize, u16)] = &[${lone.join(", ")}];`);
