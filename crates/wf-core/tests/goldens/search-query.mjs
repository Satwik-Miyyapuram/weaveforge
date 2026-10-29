// Prints the golden table in tests/search_query.rs from the TypeScript.
// Build core first (npm run build -w @weaveforge/core), then from the repo
// root on Node 24 (ICU 78.2, Unicode 17.0), then rustfmt:
//   node crates/wf-core/tests/goldens/search-query.mjs
// Only the grammar the TypeScript knows: type:, in: and modified: are
// Rust-only and tested there.
import { parseSearchQuery } from "../../../../packages/core/dist/index.js";

const INPUTS = [
  "", "   ", "Graph Neural", '"message passing" graphs',
  'vae -baseline -"work in progress"', "kind:note path:Method tag:#vae latent",
  "KIND:Paper Kind:PDF kind:bogus kind:note:extra", "path: tag: kind: tag:# tag:##x",
  '- " -" -', '"unterminated phrase', '-"unterminated exclusion',
  'a"b -a"b -a"" x"', '"" -"" "  " -"  "', 'path:""x" path:x"" path:"""',
  'tag:"#Q" tag:""y" path:"Multi', "ΣΑΣ İstanbul ÉCOLE",
  "\u{feff}word\u{a0}next\u{85}x\u{2028}y", "--double -- ---", "#hash term#",
  'a "b c" d "e" -f g', "\u{212a}IND:note", "\tkind:log\n\"Deep Dive\"  -Old  ",
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
const arr = (xs) => `&[${xs.map(rs).join(", ")}]`;

console.log("/// (input, terms, phrases, exclude, kinds, paths, tags, text)");
console.log("const CASES: &[QueryCase] = &[");
for (const w of INPUTS) {
  const q = parseSearchQuery(w);
  const cols = [q.terms, q.phrases, q.exclude, q.kinds, q.paths, q.tags].map(arr);
  console.log(`(${rs(w)}, ${cols.join(", ")}, ${rs(q.text)}),`);
}
console.log("];");
