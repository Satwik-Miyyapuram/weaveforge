# Overleaf core (`overleaf`)

The `overleaf` module holds the pure rules for exporting to Overleaf: which
project and file ids are valid, how a section target is cleaned, which export
paths are safe, how BibTeX is written, how error text is redacted, and how
collaborative text edits are transformed. The network calls and the cookie
stay in TypeScript.

## Rust submodules

`overleaf.rs` holds the link rules. Its submodules are in
`crates/wf-core/src/overleaf/`.

- `overleaf.rs`: project id and entry file validation, section target sanitizing,
  and project URLs.
- `bibtex`: cite keys for the LaTeX body, the keys the body cites, and one
  `references.bib` entry per paper.
- `error_redact`: Overleaf error text made safe to show. The token and any URL
  credentials are removed, and the text is capped at 500 UTF-16 units.
- `export_path`: the export path guard and the missing-figure warning.
- `text_ot`: ShareJS "text" operations, the format Overleaf's editor uses.
- `upload`: the root folder id from Overleaf's join answer.

## How the app calls it

The module is exported from the wasm core through `crates/wf-wasm/src/overleaf_*.rs`.
Examples of the JavaScript names:

- `overleaf_bibtex`: `paperToBibtex`, `libraryBibtex`, `collectCitedKeys`, `joinBibtex`.
- `overleaf_error`: `redactOverleafErrorText`.
- `overleaf_export_path`: `assertSafeExportPath`, `missingFigureWarning`.
- `overleaf_export_package`: `walkOverleafSections`, `withMissingFigures`.
- `overleaf_link`: `checkOverleafLinkFolder`, `parseOverleafLinks`.
- `overleaf_text_ot`: `applyTextOp`, `transformTextOps`.
- `overleaf_tree`: `flattenOverleafDocs`, `flattenOverleafFiles`.
- `overleaf_upload`: `rootFolderIdOf`.

TypeScript reaches these through the wrappers in `packages/wf-wasm/src`, which
call `readyCore()` for the loaded core and `typedCore()` for typed results. The
Overleaf feature in `apps/web/src/features/overleaf/` calls the wrappers.

## Export flow

The export takes the report, turns each section into LaTeX with
`report::markdown_to_latex`, writes a `references.bib` through `bibtex`, checks
each output path with `export_path`, and then uploads the package. Missing
figures are reported with the warning from `export_path`, so the export does not
fail on them. Any error text shown to the reader goes through `error_redact`
first, so a token or credential cannot appear in the message.

## Limits and error text

- Error text is capped at 500 UTF-16 units after redaction.
- Export paths that fail the guard are rejected before any upload starts.
- Text operations follow the ShareJS "text" format. An operation that does not
  transform cleanly is an error, not a silent merge.

## What stays in TypeScript, and why

- The HTTP client and the Overleaf session cookie stay in
  `apps/web/src/features/overleaf/infrastructure/`. The cookie is a secret and
  does not cross into wasm, and the requests need the browser's fetch.
- The collaborative editor connection stays in TypeScript, because it holds the
  socket. `text_ot` only transforms the operations it is given.
- `apps/web/src/features/overleaf/application/bibtex-export.ts` is deleted. Its
  logic lives in `bibtex`. The file is not part of the port.

## Related

- [Report core](report.md) for the Markdown that the export converts.
- [Reader core](reader.md) for the other module that keeps network I/O in TypeScript.

Source: `crates/wf-core/src/overleaf/`
