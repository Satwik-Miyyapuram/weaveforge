// FROZEN: the TypeScript this script read was deleted in P1.8b. It cannot be
// rerun; the golden tables it printed are now the spec.
// Prints the golden tables in tests/search_text.rs from the TypeScript.
// Run from the repo root on Node 24 (ICU 78.2, Unicode 17.0), then rustfmt:
//   node crates/wf-core/tests/goldens/search-text.mjs
// Print the versions with:
//   node -p "process.versions.node + ' ' + process.versions.icu + ' ' + process.versions.unicode"
import { foldDiacritics, processTerm, isCjk } from "../../../../packages/core/src/search/search-tokenizer.ts";
const words = ["café", "MÜLLER", "Ångström", "naïve", "Ⅻ", "ǅ", "ΣΑΣ", "İstanbul", "ß", "ﬁ", "é", "Å", "ḱ", "Œuvre", "Ｗｉｄｅ",
  "مُحَمَّد", "مُحَمَّدٌ", "قُرْآن", "ٰا", "ۖا", "", "abc", "日本語", "한국어", "\u{20000}x", "𝐀𝐁", "Ǆ", "Ἀθῆναι", "ﬀ", "ﭐ", " x", "Ⓐ", "̈́", "क़"];
const BS = String.fromCharCode(92);
const rs = (s) => {
  let o = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    o += c < 0x20 || c > 0x7e || ch === '"' || ch === BS ? `${BS}u{${c.toString(16)}}` : ch;
  }
  return `"${o}"`;
};
console.log("// fold: (input, fold_diacritics(input, false), fold_diacritics(input, true))");
for (const w of words) console.log(`(${[w, foldDiacritics(w), foldDiacritics(w, true)].map(rs).join(", ")}),`);
console.log("// process_term: (input, {fold:true, arabic:false}, {fold:false, arabic:false}, {fold:true, arabic:true})");
for (const w of words)
  console.log(`(${[w, processTerm(w), processTerm(w, { foldDiacritics: false }), processTerm(w, { foldArabicDiacritics: true })].map(rs).join(", ")}),`);
console.log("// is_cjk: (char, expected)");
const cps = [0x3039, 0x3040, 0x30ff, 0x3100, 0x33ff, 0x3400, 0x4dbf, 0x4dc0, 0x4e00, 0x9fff, 0xa000, 0xf8ff, 0xf900, 0xfaff, 0xfb00, 0xabff, 0xac00, 0xd7af, 0xd7b0, 0x20000, 0x41, 0x3000];
for (const c of cps) console.log(`('${BS}u{${c.toString(16)}}', ${isCjk(String.fromCodePoint(c))}),`);
