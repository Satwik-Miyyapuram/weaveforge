# Report core (`report`)

The `report` module holds the pure rules behind the report (thesis) editor:
sections and their outline, word-count progress, citation keys, the
bibliography check, and the Markdown to LaTeX export for Overleaf. Nothing in
it reads files or the network; the app passes values in and gets values back.

## Rust submodules

Each line is one file under `crates/wf-core/src/report/`.

- `artifact_markdown`: rewrite experiment artifact references in report Markdown
  into figures or warning lines.
- `artifact_refs`: parse, serialise and name `expartifact:` references.
- `bib_entries`: read a `.bib` file well enough to ask questions about it.
  Anything unreadable becomes a warning.
- `bibliography_report`: find cited keys that are undefined and defined keys that
  are never cited.
- `cite_key`: what a paper is called in a bibliography.
- `edited_label`: the relative part of the "edited 3h ago" label on a section.
- `markdown_to_latex`: the Markdown subset that becomes LaTeX in an Overleaf export.
  Equations stay as raw TeX.
- `prisma_figure`: the PRISMA flow diagram as a TikZ figure a report can `\input`.
- `project_path`: normalise paths inside a report project.
- `report_section`: create a section and build the outline tree.
- `section_progress`: words written against each section's target.
- `section_sources`: count the distinct sources a section draft cites, from
  `[[wikilinks]]` and `@citekeys`.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src`. The TypeScript wrappers in
`packages/wf-wasm/src` reach them through `readyCore()`, and the app imports
those wrappers.

- `report-records.ts`: `createReportSection`, `createReportSectionWith`,
  `reportSectionInputError`, `buildSectionTree`, `sectionProgress`,
  `outlineProgress`, `countSectionSources`, `editedRelativeLabel`,
  `normalizeProjectPath`, `checkBibliography`, `prismaFigureTex`, `prismaCaveat`.
- `report-cite-key.ts`: `resolveCiteKey`, `uniqueCiteKey`, `formatCitation`,
  `formatPaperCitation`.
- `report-bib-entries.ts`: `parseBibEntries`, `parseLatexSectionTree`.
- `report-markdown-to-latex.ts`: `markdownToLatex`, `escapeLatexText`,
  `uniqueFigureName`, `uniqueFigureNameIn`.
- `report-artifacts.ts`: `parseArtifactRefs`, `serialiseArtifactRef`,
  `artifactBasename`, `resolveArtifactRefsMarkdown`, `safeArtifactCaption`,
  `safeImageDestination`.

## What stays in TypeScript, and why

- The date fallback of the "edited" label, for an edit a week old or older. It
  depends on the reader's locale, so it stays in the browser.
- Loading and saving sections, `.bib` files and images. That is I/O, so it stays
  in the repositories and hooks around the core.
- The editor UI, which is not part of the port.

## Related

- [Overleaf core](overleaf.md) for the export package that uses `markdown_to_latex`.
- [Reader analysis core](reader-analysis.md) for bibliography parsing inside PDFs.

Source: `crates/wf-core/src/report/`
