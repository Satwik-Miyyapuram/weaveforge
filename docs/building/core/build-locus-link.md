# Build locus link (`reader::build_locus_link`)

Rust: `crates/wf-core/src/reader/build_locus_link.rs`.
Wasm: `crates/wf-wasm/src/reader_build_locus_link.rs`.
TS wrapper: `packages/wf-wasm/src/wrappers-9.ts` (star-exported from `index.ts`).
Callers use `readyCore().buildLocusLink(...)`; the TS shim is gone.

Pure logic: builds the same-origin `/reader?...` deep link for a locus.

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `buildLocusLink(input)` | `build_locus_link(&LocusLinkInput)` | Input is `LocusLinkInput` (camelCase). Returns `/reader?{query}` or `/reader`. |

## Rules

- Query order: `paper` (empty string treated as absent), `pdf` (through `sanitize_pdf_url`, https only), `locus` (through `encode_locus`), `page`.
- `page` is written only when it is an integer `>= 0`. Non-integer, negative, NaN and infinite values are dropped.
- Query string is built with `url::form_urlencoded::Serializer`, so spaces become `+` as in `URLSearchParams`.
- Page numbers are formatted as JS `String(n)` (`js_number_string`): `-0` prints `0`.

## Parity notes

- Integers `>= 1e21` print in exponent form in JS. The shortest-digit output for these is not verified.
- The TS shim passes `PdfLocus` where the Rust input is `AnchorPdfLocus`; the shapes need a check.
