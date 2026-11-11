# Resolve paper PDF source (`reader::pdf_source_ladder`, order only)

Rust: `crates/wf-core/src/reader/pdf_source_ladder.rs` (`default_resolver_order`, `PdfSourceKind`).
Wasm: `crates/wf-wasm/src/reader_pdf_source_ladder.rs` (`pdfSourceResolverOrder`).
TS wrapper: `packages/wf-wasm/src/wrappers-9.ts` (star-exported from `index.ts`).
TS shim: `apps/web/src/features/reader/application/parts-3.ts` (kept; importers `download-library-pdfs.ts` and `resolve-paper-pdf-for-reader.ts`).

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `pdfSourceResolverOrder(hasCache, hasGithub)` | `default_resolver_order(has_cache, has_github) -> Vec<PdfSourceKind>` | Order: `cache` (when present), `openAccess`, `githubRepo` (when present), `webDav`. |

`PdfSourceKind` is serialised camelCase: `cache`, `openAccess`, `githubRepo`, `webDav`.

## THIN (stays in TS)

- `githubRemotePdfSources`: the desktop probe, the 60 s memo and the `/api/github-file` fetch.
- `paperToPdfSourcePaper`: the metadata merge. It uses `serde_json::Value`, which has no specta precedent.
- `resolvePaperPdfSource` and the resolver instances (`OpenAccessPdfResolver`, `WebDavPdfResolver`, `PdfByteCacheResolver`, `GitHubRepoPdfResolver`) with their `fetch` and resolve IO.
- `resolvePdfSource` from `@weaveforge/core`.

## Parity notes

- Only the order is Rust. The TS binds each kind to its resolver instance, and a kind with no instance is dropped.
- `openAccess` and `webDav` are always present, as before.
