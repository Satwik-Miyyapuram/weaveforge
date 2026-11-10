# Reader analysis core (`reader_analysis`)

The `reader_analysis` module reads the text layer of a PDF and works out its
structure: lines, columns, headings, the bibliography, and every citation and
figure mention. It takes the runs and links that pdf.js already extracted and
returns plain values, so the analysis can be tested without a PDF engine.

## Rust submodules

Each line is one file under `crates/wf-core/src/reader_analysis/`.

- `bibliography`: split the bibliography into entries and read their fields.
- `citation_assembly`: build one page's citations from the text candidates.
- `citation_matcher`: match a page's citations and map them to PDF rectangles.
- `citation_style`: detect whether the body cites by `[n]`, by `(Author year)`, or both.
- `citations`: citation candidates and pattern mentions in the page text.
- `document_analysis`: the full pass over the text layer and links.
- `figure_mentions`: figure, table, equation, section and algorithm mentions, each
  resolved to its caption or heading.
- `headings`: heading detection and outline building from reconstructed lines.
- `lines`: text lines from pdf.js runs, column detection and running-head keys.
- `outline`: outline inference from text runs, for documents with no bookmarks.
- `pdf_links`: citation mentions read from the document's own `/Link` annotations.
- `reference_section`: the bibliography section finder and its fallback.
- `running_heads`: removal of repeated headers, footers, page numbers and banners.
- `text`: invisible-character stripping, a normalised search text mapped back to raw
  PDF offsets, and PDF rectangles for spans of it.
- `types`: the shared analysis vocabulary. Optional fields are left out when `None`.

## How the app calls it

The module is exported from the wasm core through
`crates/wf-wasm/src/reader_analysis_*.rs`, with one file per submodule group.
Examples of the JavaScript names:

- `reader_analysis_document`: `analyzePdfDocument`, `outlineItemOf`.
- `reader_analysis_bibliography`: `parseBibliography`, `parseBibliographyEntry`.
- `reader_analysis_lines`: `reconstructLines`, `detectColumns`, `pageTextFromItems`.
- `reader_analysis_outline`: `outlineFromText`, `groupRecurringLines`.
- `reader_analysis_structure`: `findFigureMentions`, `assemblePageCitations`,
  `matchPageCitations`, `headingOutline`.
- `reader_analysis_citations` and `reader_analysis_text`: citation candidates and
  text helpers.

The TypeScript wrappers in `packages/wf-wasm/src` call these through
`readyCore()`, and through `typedCore()` where typed results are needed. The
analysis pass runs in the reader, once per opened document.

## Offsets and units

Positions in page text are UTF-16 offsets, because JavaScript string indexes are
UTF-16. Regex matches in `bibliography` use UTF-8 byte offsets internally, so
callers must not mix the two. `text` maps a normalised search string back to raw
PDF offsets, so a match can still be highlighted on the original glyphs.

## What stays in TypeScript, and why

- `lines` keeps the `keep` callback in TypeScript. The callback is supplied by
  the caller at run time and decides which runs to keep, so it cannot cross the
  wasm boundary as a pure value.
- Nothing in `figure_mentions` stays in TypeScript. The whole submodule is pure
  and has been ported.
- The pdf.js calls that produce the runs and links stay in TypeScript. They need
  the PDF worker. Rust starts from the extracted values.

## Related

- [Reader core](reader.md) for the annotation and search rules that use these positions.
- [Report core](report.md) for the bibliography checks that use the same entries.

Source: `crates/wf-core/src/reader_analysis/`
