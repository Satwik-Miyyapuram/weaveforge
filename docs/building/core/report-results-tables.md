# Report results tables (`report::results_table_refs`)

A report note can hold a live results table: an `exptable:` reference to an
experiment's runs. The table is not stored in the note. It is rebuilt from the
current runs each time the note is previewed or exported, so it never goes
stale. The stored Markdown is byte-for-byte what it was before the port.

## Rust functions

All in `crates/wf-core/src/report/results_table_refs.rs`.

- `serialise_results_table_ref`: write one reference as the Markdown the note
  stores.
- `parse_results_table_refs`: find every reference in a note body. Offsets are
  UTF-16 code units, so they line up with JavaScript string indices.
- `resolve_results_tables(body, experiments, latex)`: replace each reference
  with a table built from the experiments passed in. It builds Markdown, or
  LaTeX when `latex` is true.

The Markdown and LaTeX table renderers are private and are not exported to wasm.

- `results_tables_presence::has_results_tables(nodes)`: whether any section in
  the report tree, or a descendant, has an `exptable:` reference in its notes.
  Missing or null notes count as empty. Own notes are checked before children.
  Lives in `crates/wf-core/src/report/results_tables_presence.rs`; wasm export
  `hasResultsTables` in `crates/wf-wasm/src/report_results_presence.rs`; wrapper
  `packages/wf-wasm/src/report-results-presence.ts`. It replaces the TS walk in
  `download-overleaf-export.ts`, which decides whether experiments are loaded
  before the Overleaf export. It does not check the 16Mi cap, same as
  `parseResultsTableRefs`.

## How the app calls it

`crates/wf-wasm/src/report_results_tables.rs` exports `serialiseResultsTableRef`,
`parseResultsTableRefs` and `resolveResultsTables(body, experiments, format)`.
A `format` of `"latex"` sets the core flag; any other value gives Markdown. The
wrapper `packages/wf-wasm/src/report-results-tables.ts` keeps the old
signatures, including the default caption "Results", and the app reaches it
through `readyCore()`:

- the report preview parses and resolves references
- the experiment artifact picker serialises a new reference
- the Overleaf export parses and resolves them, with `"latex"`

These calls throw until `loadCore()` has resolved. Every caller above runs after
the core is loaded.

## What stays in TypeScript, and why

- Loading the experiments and their runs. That is I/O.
- The picker and preview UI, which is not part of the port.

## Related

- [Report core](report.md) for the other report rules and `expartifact:` references.

Source: `crates/wf-core/src/report/results_table_refs.rs`
