# Phase 1 design: search pilot

One page, per plan §4.3. Plan: [plan.md](plan.md) § Phase 1.

## Scope

MiniSearch stays the BM25 engine. "Rust ranking" means the pure parts of
`packages/core/src/search` run in Rust through WASM:

| TS today | Rust (wf-core `search::`) |
| --- | --- |
| `search-tokenizer.ts` | `tokenizer`: `fold_diacritics`, `process_term`, `is_cjk`, `url_parts`, `tokenize`, `index_terms` |
| `search-query.ts` | `query`: `parse_query` → ordered `Vec<Clause>`, `ParsedQuery`, `format_query` |
| `rank-fusion.ts` | `fusion`: `fuse_rankings` over ids and weights |
| `search-excerpt.ts` (+ `findDocumentMatches` fold) | `excerpt`: `build_excerpt` on UTF-16 |

The switch PR deletes those four TS files. `excerptSegments` moves to
apps/web as a UI helper; `hybrid-fusion.queryTermCount` takes its terms as a
parameter. `findDocumentMatches` stays in TS for the reader.

## Matching JavaScript exactly

- **Strings.** Lengths and offsets that TS measures in UTF-16 units are UTF-16
  in Rust too (`utf16_len`, excerpt works on `Vec<u16>`).
- **Whitespace.** JS `\s`/`trim()`: `\t \n \v \f \r`, space, U+00A0, U+1680,
  U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Not U+0085
  (Rust's `char::is_whitespace` differs on both U+0085 and U+FEFF), so
  `js_text::is_js_whitespace` is hand-written.
- **Letters and numbers.** `\p{L}` = general category L*; `\p{N}` = N*.
  `unicode-properties` gives the category; `char::is_alphabetic` is wrong.
- **ASCII-only regex parts.** `/i` and `\b` without the `u` flag are ASCII
  only (no Kelvin sign for `k`). No `regex` crate: the patterns are small,
  hand-written scanners keep the WASM small and avoid Unicode-mode drift.
- **Order.** TS returns `[...Set]` in insertion order; Rust uses a `Vec` plus
  a seen-set, never a bare `HashSet`.
- **CJK** ranges are BMP-only, copied from the TS bytes. Supplementary Han
  (Extension B+) is not CJK, in both.
- **Unicode versions.** Node 24 ICU is Unicode 17; `unicode-normalization`
  0.1.26 is 18. Fixtures use only characters assigned before 17. Drift on new
  characters is accepted and documented.
- **Lone surrogates** become U+FFFD at the wasm-bindgen edge. Both are
  separators for the tokenizer, so tokens match; excerpts may differ by one
  code unit on such input. Kept out of parity.

## Limits (§4.3)

The TS has none; adding a cap would change results. Rust names its constants
(`MIN_TOKEN_UTF16_LEN = 2`, `URL_TLDS`, `CJK_RANGES`, `RRF_K = 60`,
`EXCERPT_MIN_CHARS = 40`, `EXCERPT_DEFAULT_CHARS = 240`,
`MAX_MODIFIED_DAYS = 36_500`). Inputs are unbounded by design: the index feeds
whole PDFs, and every pass is linear.

## Parser and kensaku filters

`parse_query` keeps today's grammar and adds `type:` (alias of `kind:`),
`in:` (alias of `path:`) and `modified:<n><d|w|m|y>` → `modifiedWithinDays`
(`m` = 30, `y` = 365 days; the smallest wins; invalid or over the limit is
dropped). `SearchKind` is an enum. `format_query` prints the canonical form;
proptest: parsing never panics and `parse(format(parse(s))) == parse(s)`.

## Fusion

Rust takes `[{ids, weight}]` and returns ordered ids; the TS wrapper maps ids
back to items. Ties break on ordinal key order instead of `localeCompare`
(documented change; fixtures use keys where both agree).

## Parity and goldens

TS halves import `@weaveforge/core` (devDependency of `@weaveforge/wasm`,
never apps/web). A generator script writes `parity/fixtures/<case>/*.json`
from the TS; the JSON stays as frozen goldens after the TS is deleted.
Tokenizer fixtures cover all 16 option combinations. New filters get Rust
golden tests only. The None→null / map→object shape test ships with the
parser export (`modifiedWithinDays: null`).

## Performance

`index_terms(text)` = `tokenize` then `process_term`, no dedup after mapping
(MiniSearch counts term frequency). MiniSearch's `processTerm` becomes the
identity. Done when `indexPdf` tokenize ≤ 111 ms in Dev (target < 50 ms).

## PRs

1. P1.1a `js_text` helpers, `fold_diacritics`, `process_term`, `is_cjk`.
2. P1.1b `url_parts`, `tokenize`, `index_terms`, proptest.
3. P1.2 tokenizer WASM exports, TS wrappers, parity, budget note.
4. P1.3 parser + filters + `format_query` + proptest. P1.4 export + parity.
5. P1.5 fusion. P1.6 excerpt. P1.7 their exports + parity.
6. P1.8 switch web and desktop, delete the TS, measure `indexPdf`.
