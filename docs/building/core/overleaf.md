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
- `upload_reason`: the `: <message>` suffix an upload failure shows, read from Overleaf's answer body.
- `thumb`: the storage key for a project's card picture and the 300 KB size gate.
- `project_list`: the merge of account projects with linked reports, and the search and picked-row rules. The sort stays in TS.

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
- `overleaf_upload_reason`: `uploadErrorSuffix`.
- `overleaf_thumb`: `thumbKey`, `thumbFits`.
- `overleaf_project_list`: `mergeOverleafProjects`, `overleafProjectMatches`, `overleafProjectShown`.

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
- The old TypeScript BibTeX export is deleted. Its logic lives in `bibtex`.

## Related

- [Report core](report.md) for the Markdown that the export converts.
- [Reader core](reader.md) for the other module that keeps network I/O in TypeScript.

Source: `crates/wf-core/src/overleaf/`

## More Overleaf modules

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `export_package` | `build_export_package` | `buildOverleafExportFiles` | `apps/web/src/features/overleaf/application/parts.ts` |
| `path_guard` | `unsafe_checkout_path_error`, `is_text_source_file`, `file_count_error`, `text_size_error` | `assertSafeCheckoutPath`, `isOverleafTextSource`, `assertOverleafFileCount`, `assertOverleafTextSize` | `apps/web/src/features/overleaf/infrastructure/overleaf-git-reader.ts` |
| `report_statements` | `create_report_statement`, `patch_report_statement` | `planOverleafReportCreate`, `planOverleafReportPatch` | `apps/web/src/features/overleaf/infrastructure/local-overleaf-gateway.ts` |

Rules:

- `export_package`: `references.bib` holds every library paper for scope `all`, which also gives `main.tex` `\nocite{*}`. Scope `cited` keeps only the papers whose keys the body cites. A blank or absent title becomes `WeaveForge report export`.
- `path_guard`: a checkout path is refused when it is empty, starts with `/`, has a backslash, a drive letter or a `..` segment. Only `.tex`, `.bib`, `.sty`, `.cls`, `.txt`, `.md` and `.cfg` files are kept, case-insensitively. The `assert*` wasm exports throw; the Rust fns return the message or `None`.
- `path_guard`: limits are 250 text files, 2,000,000 bytes per file and 20,000,000 bytes in total. The walk stops once 250 are kept.
- `report_statements`: a blank entry file becomes `main.tex`. An invalid project id or entry file is refused. A patch changes only the fields named, and a change of project or file clears the recorded failure.
